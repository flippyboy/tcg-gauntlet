// The SQLite implementation of the engine's CardLookup. It must agree with the
// in-memory lookup in packages/conformance (fake-lookup.ts) on every verdict.
import type { Statement } from "better-sqlite3";
import { LRUCache } from "lru-cache";
import {
  type CardLookup,
  type CardRef,
  type FormatDef,
  type FormatKey,
  type OfficialFormatName,
  type OfficialLegality,
  type PrintingRef,
  compareCodePoints,
  mapMtgjsonLegality,
  normalizeName,
} from "@tcg-gauntlet/engine";
import type { Derived } from "./derived.js";
import type { PrintingRow } from "./mtgjson-queries.js";

/** Layouts that have a physical back face to show. */
const BACK_FACE_LAYOUTS = new Set([
  "transform",
  "modal_dfc",
  "reversible_card",
]);

const list = (s: string | null): string[] =>
  s === null || s === "" ? [] : s.split(/,\s*/).filter((x) => x !== "");

const isFront = (r: { side: string | null }): boolean =>
  r.side === null || r.side === "a";

/** Every run of three characters. The FTS5 trigram index matches on these. */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Candidates that share less than this part of their trigrams with the query are dropped. */
const MIN_SUGGEST_OVERLAP = 0.3;

export interface SqliteCardLookupOptions {
  /** Size of the `findCard` cache. Default 10,000. */
  cacheSize?: number;
}

export class SqliteCardLookup implements CardLookup {
  private readonly cards: LRUCache<string, CardRef | false>;
  private readonly meta: Statement;
  private readonly inPoolStmt: Statement;
  private readonly defaultStmt: Statement;
  private readonly findNameStmt: Statement;
  private readonly suggestStmt: Statement;
  private readonly builtFormats = new Set<FormatKey>();

  constructor(
    private readonly derived: Derived,
    opts: SqliteCardLookupOptions = {},
  ) {
    this.cards = new LRUCache({ max: opts.cacheSize ?? 10_000 });
    // The name tables must exist before the statements below can be prepared.
    derived.buildBase();
    const db = derived.db;
    this.findNameStmt = db.prepare(
      "SELECT name FROM main.card_names WHERE norm_name = ?",
    );
    this.meta = db.prepare(
      "SELECT supertypes, layout, copy_exempt FROM main.card_meta WHERE name = ?",
    );
    this.inPoolStmt = db.prepare(
      "SELECT 1 FROM main.format_pool WHERE format_key = ? AND name = ?",
    );
    this.defaultStmt = db.prepare(
      "SELECT uuid FROM main.default_printing WHERE format_key = ? AND name = ?",
    );
    this.suggestStmt = db.prepare(
      `SELECT n.name AS name, n.norm_name AS norm
       FROM card_names_fts JOIN card_names n ON n.rowid = card_names_fts.rowid
       WHERE card_names_fts MATCH ?
       ORDER BY bm25(card_names_fts) LIMIT ?`,
    );
  }

  close(): void {
    this.derived.close();
  }

  dataVersion(): string {
    return `mtgjson ${this.derived.getMeta("mtgjson_version") ?? "unknown"}`;
  }

  /** Builds the pool and default printings of a custom format, unless they exist. */
  registerFormat(key: FormatKey, def: FormatDef): void {
    this.derived.ensureFormats([
      { key, def: key.startsWith("official:") ? null : def },
    ]);
    this.builtFormats.add(key);
  }

  /** The number of cards in the pool of a built custom format. */
  poolSize(formatKey: FormatKey): number {
    this.requireFormat(formatKey);
    const row = this.derived.db
      .prepare(
        "SELECT COUNT(*) AS n FROM main.format_pool WHERE format_key = ?",
      )
      .get(formatKey) as { n: number };
    return row.n;
  }

  private requireFormat(key: FormatKey): void {
    if (this.builtFormats.has(key)) return;
    if (!this.derived.hasFormat(key)) {
      // Official formats need no registration: they have no definition.
      if (!key.startsWith("official:"))
        throw new Error(`format ${key} is not registered`);
      this.derived.ensureFormats([{ key, def: null }]);
    }
    this.builtFormats.add(key);
  }

  findCard(name: string): CardRef | null {
    const norm = normalizeName(name);
    const hit = this.cards.get(norm);
    if (hit !== undefined) return hit === false ? null : hit;
    const row = this.findNameStmt.get(norm) as { name: string } | undefined;
    const card = row === undefined ? null : this.cardRef(row.name);
    this.cards.set(norm, card ?? false);
    return card;
  }

  private cardRef(name: string): CardRef | null {
    const rows = this.derived.queries.printingsByName(name);
    const front = rows.find(isFront) ?? rows[0];
    const meta = this.meta.get(name) as
      | {
          supertypes: string | null;
          layout: string;
          copy_exempt: string | null;
        }
      | undefined;
    if (front === undefined || meta === undefined) return null;
    const faces = new Map<string, string>();
    for (const r of rows) {
      const side = r.side ?? "a";
      if (!faces.has(side)) faces.set(side, r.faceName ?? r.name);
    }
    return {
      name,
      oracleKey: name,
      types: list(front.types),
      supertypes: list(meta.supertypes),
      layout: meta.layout,
      manaValue: front.manaValue ?? 0,
      faces: [...faces.entries()]
        .sort(([a], [b]) => compareCodePoints(a, b))
        .map(([side, n]) => ({ name: n, side })),
      copyExempt:
        meta.copy_exempt === "basic" || meta.copy_exempt === "any_number"
          ? meta.copy_exempt
          : null,
    };
  }

  private printingRef(r: PrintingRow | null): PrintingRef | null {
    if (r === null) return null;
    return {
      uuid: r.uuid,
      cardName: r.name,
      set: r.setCode,
      number: r.number,
      scryfallId: r.scryfallId,
      releasedAt: r.releaseDate,
      availability: list(r.availability),
      hasBackFace: BACK_FACE_LAYOUTS.has(r.layout ?? ""),
    };
  }

  findPrinting(
    set: string,
    number: string | undefined,
    cardName: string,
  ): PrintingRef | null {
    const q = this.derived.queries;
    return this.printingRef(
      number === undefined
        ? q.lowestNumberInSet(set, cardName)
        : q.printingBySetNumber(set, number, cardName),
    );
  }

  /**
   * MTGJSON stores legality per printing, so the value of a card is taken over all
   * its rows: missing values are ignored, and of the rest Banned beats Restricted
   * beats Legal (spec/format-definition.md, "Combining printings").
   */
  officialLegality(
    format: OfficialFormatName,
    card: CardRef,
  ): OfficialLegality {
    const values = new Set(
      this.derived.queries.officialLegality(format, card.name),
    );
    for (const v of ["Banned", "Restricted", "Legal"]) {
      if (values.has(v)) return mapMtgjsonLegality(v);
    }
    return mapMtgjsonLegality(null);
  }

  inPool(formatKey: FormatKey, card: CardRef): boolean {
    if (formatKey.startsWith("official:")) return true;
    this.requireFormat(formatKey);
    return this.inPoolStmt.get(formatKey, card.name) !== undefined;
  }

  defaultPrinting(formatKey: FormatKey, card: CardRef): PrintingRef | null {
    this.requireFormat(formatKey);
    const row = this.defaultStmt.get(formatKey, card.name) as
      { uuid: string } | undefined;
    return row === undefined
      ? null
      : this.printingRef(this.derived.queries.printingByUuid(row.uuid));
  }

  arenaPrinting(card: CardRef): PrintingRef | null {
    return this.printingRef(this.derived.queries.arenaPrinting(card.name));
  }

  /**
   * Close names, ranked by bm25 over the FTS5 trigram index. The query is an OR of
   * the trigrams of the input, so a typo still matches. Candidates that share under
   * 30% of their trigrams with the input are dropped.
   */
  suggest(name: string, limit: number): string[] {
    const norm = normalizeName(name);
    const grams = trigrams(norm);
    if (grams.size === 0 || limit <= 0) return [];
    const match = [...grams]
      .map((g) => `"${g.replaceAll('"', '""')}"`)
      .join(" OR ");
    const rows = this.suggestStmt.all(match, limit * 5 + 10) as {
      name: string;
      norm: string;
    }[];
    const out: string[] = [];
    for (const r of rows) {
      if (out.includes(r.name)) continue;
      const theirs = trigrams(r.norm);
      let shared = 0;
      for (const g of grams) if (theirs.has(g)) shared++;
      if (shared / Math.max(grams.size, 1) < MIN_SUGGEST_OVERLAP) continue;
      out.push(r.name);
      if (out.length === limit) break;
    }
    return out;
  }
}
