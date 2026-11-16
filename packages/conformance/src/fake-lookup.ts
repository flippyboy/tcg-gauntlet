// An in-memory CardLookup built from conformance/fixtures/cards.json. It follows
// the spec rules exactly (front-face rows, English, COALESCE flag semantics, the
// default printing order), so that it agrees with the SQLite implementation.
import { readFileSync } from "node:fs";
import {
  type CardLookup,
  type CardRef,
  type FormatDef,
  type FormatKey,
  type OfficialFormatName,
  type OfficialLegality,
  type PrintingRef,
  compareCodePoints,
  legalityColumn,
  mapMtgjsonLegality,
  normalizeName,
} from "@tcg-gauntlet/engine";

/** One MTGJSON `cards` row, with the columns the rules need. NULL stays null. */
export interface FixtureCard {
  uuid: string;
  name: string;
  faceName: string | null;
  side: string | null;
  setCode: string;
  number: string;
  language: string | null;
  availability: string | null;
  isFunny: number | null;
  isOnlineOnly: number | null;
  isOversized: number | null;
  isPromo: number | null;
  originalReleaseDate: string | null;
  layout: string | null;
  types: string | null;
  supertypes: string | null;
  manaValue: number | null;
  text: string | null;
  scryfallId: string | null;
  legalities: Record<string, string | null>;
}

export interface FixtureSet {
  code: string;
  name: string | null;
  releaseDate: string | null;
  type: string | null;
}

export interface FixtureData {
  mtgjson: { version: string | null; date: string | null };
  sets: FixtureSet[];
  cards: FixtureCard[];
}

/** Layouts whose faces are halves of one card. A half is not a card name. */
const SPLIT_LAYOUTS = new Set(["split", "aftermath"]);
/** Layouts that have a physical back face to show. */
const BACK_FACE_LAYOUTS = new Set([
  "transform",
  "modal_dfc",
  "reversible_card",
]);

const list = (s: string | null): string[] =>
  s === null || s === "" ? [] : s.split(/,\s*/).filter((x) => x !== "");

const flag = (v: number | null): boolean => (v ?? 0) !== 0;

const isFront = (c: FixtureCard): boolean => c.side === null || c.side === "a";

/** The first run of ASCII digits as a number. No digits sorts last. */
function numericPart(number: string): number {
  const m = /[0-9]+/.exec(number);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

export class FakeCardLookup implements CardLookup {
  private readonly sets = new Map<string, FixtureSet>();
  private readonly byName = new Map<string, FixtureCard[]>();
  private readonly nameIndex = new Map<string, string>();
  private readonly cardCache = new Map<string, CardRef>();
  private readonly formats = new Map<FormatKey, FormatDef>();
  private readonly poolCache = new Map<string, boolean>();
  private readonly defaultCache = new Map<string, PrintingRef | null>();
  private readonly arenaCache = new Map<string, PrintingRef | null>();
  private suggestIndex:
    { name: string; norm: string; grams: Set<string> }[] | null = null;

  constructor(private readonly data: FixtureData) {
    for (const s of data.sets) this.sets.set(s.code, s);
    for (const c of data.cards) {
      const rows = this.byName.get(c.name);
      if (rows) rows.push(c);
      else this.byName.set(c.name, [c]);
    }
    // Full names win over face names when two cards claim the same spelling.
    const faceNames: [string, string][] = [];
    for (const [name, rows] of this.byName) {
      this.nameIndex.set(normalizeName(name), name);
      const layout = rows[0]?.layout ?? "";
      if (SPLIT_LAYOUTS.has(layout)) continue;
      for (const r of rows) {
        if (isFront(r) && r.faceName !== null) {
          faceNames.push([normalizeName(r.faceName), name]);
        }
      }
    }
    for (const [norm, name] of faceNames) {
      if (!this.nameIndex.has(norm)) this.nameIndex.set(norm, name);
    }
  }

  dataVersion(): string {
    return `fixture ${this.data.mtgjson.version ?? "unknown"}`;
  }

  registerFormat(key: FormatKey, def: FormatDef): void {
    this.formats.set(key, def);
    for (const k of [...this.poolCache.keys()])
      if (k.startsWith(`${key}\u0000`)) this.poolCache.delete(k);
    for (const k of [...this.defaultCache.keys()])
      if (k.startsWith(`${key}\u0000`)) this.defaultCache.delete(k);
  }

  findCard(name: string): CardRef | null {
    const full = this.nameIndex.get(normalizeName(name));
    return full === undefined ? null : this.cardRef(full);
  }

  private cardRef(name: string): CardRef {
    const cached = this.cardCache.get(name);
    if (cached) return cached;
    const rows = [...(this.byName.get(name) ?? [])].sort((a, b) =>
      compareCodePoints(a.uuid, b.uuid),
    );
    const front = rows.find(isFront) ?? rows[0];
    if (front === undefined) throw new Error(`no rows for ${name}`);
    const faces = new Map<string, string>();
    for (const r of rows) {
      const side = r.side ?? "a";
      if (!faces.has(side)) faces.set(side, r.faceName ?? r.name);
    }
    const supertypes = list(front.supertypes);
    const anyNumber = rows.some((r) =>
      (r.text ?? "").includes("A deck can have any number of cards named"),
    );
    const ref: CardRef = {
      name,
      oracleKey: name,
      types: list(front.types),
      supertypes,
      layout: front.layout ?? "normal",
      manaValue: front.manaValue ?? 0,
      faces: [...faces.entries()]
        .sort(([a], [b]) => compareCodePoints(a, b))
        .map(([side, n]) => ({ name: n, side })),
      copyExempt: supertypes.includes("Basic")
        ? "basic"
        : anyNumber
          ? "any_number"
          : null,
    };
    this.cardCache.set(name, ref);
    return ref;
  }

  /**
   * MTGJSON stores legality per printing, and a printing from a set that is not
   * tournament legal has NULL (Black Lotus has 10 NULL rows and 6 Restricted ones).
   * So the value of a card is taken over all its rows: NULL is ignored, and of the
   * rest Banned beats Restricted beats Legal. All NULL means no value (not legal).
   */
  officialLegality(
    format: OfficialFormatName,
    card: CardRef,
  ): OfficialLegality {
    const col = legalityColumn(format);
    const values = new Set(
      (this.byName.get(card.name) ?? []).map((r) => r.legalities[col] ?? null),
    );
    for (const v of ["Banned", "Restricted", "Legal"]) {
      if (values.has(v)) return mapMtgjsonLegality(v);
    }
    return mapMtgjsonLegality(null);
  }

  inPool(formatKey: FormatKey, card: CardRef): boolean {
    if (formatKey.startsWith("official:")) return true;
    const cacheKey = `${formatKey}\u0000${card.name}`;
    const hit = this.poolCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const def = this.formats.get(formatKey);
    if (def === undefined)
      throw new Error(`format ${formatKey} is not registered`);
    const matches = (n: string): boolean => {
      const norm = normalizeName(n);
      return this.nameIndex.get(norm) === card.name;
    };
    let result: boolean;
    if (def.banned.some(matches) || def.exclude.some((o) => matches(o.name))) {
      result = false;
    } else if (def.include.some((o) => matches(o.name))) {
      result = true;
    } else {
      const codes = new Set(def.sets);
      result = (this.byName.get(card.name) ?? []).some(
        (r) =>
          codes.has(r.setCode) &&
          !flag(r.isFunny) &&
          !flag(r.isOnlineOnly) &&
          !flag(r.isOversized),
      );
    }
    this.poolCache.set(cacheKey, result);
    return result;
  }

  defaultPrinting(formatKey: FormatKey, card: CardRef): PrintingRef | null {
    const cacheKey = `${formatKey}\u0000${card.name}`;
    const hit = this.defaultCache.get(cacheKey);
    if (hit !== undefined) return hit;
    let codes: Set<string> | null = null;
    if (!formatKey.startsWith("official:")) {
      const def = this.formats.get(formatKey);
      if (def === undefined)
        throw new Error(`format ${formatKey} is not registered`);
      codes = new Set(def.sets);
    }
    const rows = this.byName.get(card.name) ?? [];
    let pick = this.pickDefault(rows, codes);
    if (pick === null && codes !== null) pick = this.pickDefault(rows, null);
    const result = pick === null ? null : this.printingRef(pick);
    this.defaultCache.set(cacheKey, result);
    return result;
  }

  arenaPrinting(card: CardRef): PrintingRef | null {
    const hit = this.arenaCache.get(card.name);
    if (hit !== undefined) return hit;
    const q = (this.byName.get(card.name) ?? []).filter(
      (r) =>
        list(r.availability).includes("arena") &&
        isFront(r) &&
        r.language === "English",
    );
    // Newest first, then set type, then number.
    q.sort((a, b) => this.compareDefault(a, b, true));
    const result = q[0] === undefined ? null : this.printingRef(q[0]);
    this.arenaCache.set(card.name, result);
    return result;
  }

  private pickDefault(
    rows: FixtureCard[],
    codes: Set<string> | null,
  ): FixtureCard | null {
    const q = rows.filter(
      (r) =>
        list(r.availability).includes("paper") &&
        !flag(r.isOnlineOnly) &&
        !flag(r.isFunny) &&
        !flag(r.isOversized) &&
        isFront(r) &&
        r.language === "English" &&
        (codes === null || codes.has(r.setCode)),
    );
    const nonPromo = q.filter((r) => !flag(r.isPromo));
    const pool = nonPromo.length > 0 ? nonPromo : q;
    pool.sort((a, b) => this.compareDefault(a, b));
    return pool[0] ?? null;
  }

  private compareDefault(
    a: FixtureCard,
    b: FixtureCard,
    newestFirst = false,
  ): number {
    const setA = this.sets.get(a.setCode);
    const setB = this.sets.get(b.setCode);
    const dateA = a.originalReleaseDate ?? setA?.releaseDate ?? "";
    const dateB = b.originalReleaseDate ?? setB?.releaseDate ?? "";
    if (dateA !== dateB)
      return newestFirst
        ? compareCodePoints(dateB, dateA)
        : compareCodePoints(dateA, dateB);
    const rank = (s: FixtureSet | undefined): number =>
      s?.type === "core" || s?.type === "expansion" ? 0 : 1;
    if (rank(setA) !== rank(setB)) return rank(setA) - rank(setB);
    return this.compareNumber(a, b);
  }

  private compareNumber(a: FixtureCard, b: FixtureCard): number {
    const na = numericPart(a.number);
    const nb = numericPart(b.number);
    if (na !== nb) return na < nb ? -1 : 1;
    return (
      compareCodePoints(a.number, b.number) || compareCodePoints(a.uuid, b.uuid)
    );
  }

  findPrinting(
    set: string,
    number: string | undefined,
    cardName: string,
  ): PrintingRef | null {
    const wantSet = set.toLowerCase();
    let rows = (this.byName.get(cardName) ?? []).filter(
      (r) => r.setCode.toLowerCase() === wantSet && isFront(r),
    );
    if (number !== undefined) {
      const wantNumber = number.toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase() === wantNumber);
    }
    const english = rows.filter((r) => r.language === "English");
    const pick = (english.length > 0 ? english : rows).sort((a, b) =>
      this.compareNumber(a, b),
    )[0];
    return pick === undefined ? null : this.printingRef(pick);
  }

  private printingRef(r: FixtureCard): PrintingRef {
    return {
      uuid: r.uuid,
      cardName: r.name,
      set: r.setCode,
      number: r.number,
      scryfallId: r.scryfallId,
      releasedAt: this.sets.get(r.setCode)?.releaseDate ?? null,
      availability: list(r.availability),
      hasBackFace: BACK_FACE_LAYOUTS.has(r.layout ?? ""),
    };
  }

  /** Close names by trigram similarity. The SQLite lookup ranks with bm25 instead. */
  suggest(name: string, limit: number): string[] {
    this.suggestIndex ??= [...this.nameIndex.entries()].map(([norm, full]) => ({
      name: full,
      norm,
      grams: trigrams(norm),
    }));
    const q = trigrams(normalizeName(name));
    const scored = new Map<string, number>();
    for (const e of this.suggestIndex) {
      let shared = 0;
      for (const g of q) if (e.grams.has(g)) shared++;
      const score = (2 * shared) / (q.size + e.grams.size);
      if (score >= 0.3 && score > (scored.get(e.name) ?? 0))
        scored.set(e.name, score);
    }
    return [...scored.entries()]
      .sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0]))
      .slice(0, limit)
      .map(([n]) => n);
  }
}

/** Builds the lookup from `conformance/fixtures/cards.json`. */
export function fakeLookup(cardsJsonPath: string): FakeCardLookup {
  const data = JSON.parse(readFileSync(cardsJsonPath, "utf8")) as FixtureData;
  return new FakeCardLookup(data);
}
