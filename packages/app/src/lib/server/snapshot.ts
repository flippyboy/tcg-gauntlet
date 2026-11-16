// The in-memory model every request reads. It is built from file contents (the
// working tree is never read after the scan), frozen, and swapped by reference.
import {
  type CardLookup,
  type FormatDef,
  type GauntletDef,
  type OfficialRules,
  type ResolvedDeck,
  type ParsedDeck,
  type TypeGroup,
  type Violation,
  checkDeck,
  exportDec,
  exportMtga,
  exportMtgo,
  groupByType,
  officialRules,
  parseDeck,
  parseGauntlet,
  resolveDeck,
  sortViolations,
} from "@tcg-gauntlet/engine";
import {
  type FormatResolution,
  type RepoContents,
  isFormatFailure,
  resolveFormat,
} from "@tcg-gauntlet/repo";
import { renderMarkdown } from "./markdown.js";

export interface ProxyCard {
  name: string;
  count: number;
  scryfallId: string | null;
  hasBackFace: boolean;
}

export interface DeckEntry {
  gauntlet: string;
  /** The file name without `.txt`. */
  name: string;
  /** `<gauntlet>/<name>`, the key of `decks.current_path` in history.sqlite. */
  currentPath: string;
  /** Repo-relative `.txt` path. */
  path: string;
  /** Repo-relative `.md` path of the primer, when it exists. */
  primerPath: string | null;
  displayName: string;
  parsed: ParsedDeck;
  resolved: ResolvedDeck;
  violations: Violation[];
  errorCount: number;
  warningCount: number;
  valid: boolean;
  grouping: { main: TypeGroup[]; sideboard: TypeGroup[] };
  mainCount: number;
  sideboardCount: number;
  primerHtml: string | null;
  lastUpdated: { authorTs: number; authorDate: string } | null;
  exports: {
    mtgo: string;
    dec: string;
    mtga: string;
    /** Names of cards that are not on Arena. */
    mtgaUnavailable: string[];
  };
  /** One entry per distinct card with a printing, for the proxy PDF builder. */
  proxyCards: ProxyCard[];
}

export interface GauntletEntry {
  folder: string;
  def: GauntletDef | null;
  name: string;
  formatKey: string | null;
  formatName: string | null;
  /** Gauntlet-level errors: YAML, format, scan problems and orphan primers. */
  errors: Violation[];
  descriptionHtml: string | null;
  /** Decks in the repo, including those of a gauntlet that could not be checked. */
  deckCount: number;
  invalidCount: number;
  decks: DeckEntry[];
}

export interface Snapshot {
  commit: string;
  builtAt: string;
  mtgjson: { version: string; date: string };
  gauntlets: GauntletEntry[];
  /** Scan problems that belong to no gauntlet. */
  errors: Violation[];
  /** `scryfallId` to `hasBackFace`, for the image route. */
  allowedImages: ReadonlyMap<string, { hasBackFace: boolean }>;
  /** Used for old versions at request time. */
  lookup: CardLookup;
  /** Keys of the formats this snapshot uses. */
  formats: string[];
}

export interface BuildOptions {
  presetsDir: string;
  commit: string;
  mtgjson: { version: string; date: string };
  /** `current_path` to last-updated, from the history database. */
  lastUpdated: ReadonlyMap<string, { authorTs: number; authorDate: string }>;
  now?: () => Date;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** The format of a gauntlet (or its failure), keyed by folder. */
export interface GauntletFormat {
  folder: string;
  yamlPath: string;
  def: GauntletDef | null;
  violations: Violation[];
  resolution: FormatResolution | null;
}

/**
 * Parses every `gauntlet.yaml` and resolves its format. Without `lookup` the card-name
 * check of custom formats is skipped, so the result can feed the card data refresh.
 */
export async function resolveGauntletFormats(
  contents: RepoContents,
  presetsDir: string,
  lookup?: CardLookup,
): Promise<GauntletFormat[]> {
  const out: GauntletFormat[] = [];
  for (const g of contents.gauntlets) {
    const yamlPath = `${g.folder}/gauntlet.yaml`;
    const parsed = parseGauntlet(g.yamlText, yamlPath);
    const bad = parsed.violations.some((v) => v.severity === "error");
    const def = bad ? null : parsed.def;
    let resolution: FormatResolution | null = null;
    if (def !== null) {
      resolution = await resolveFormat(def, contents, {
        presetsDir,
        file: yamlPath,
        ...(lookup === undefined ? {} : { lookup }),
      });
    }
    out.push({
      folder: g.folder,
      yamlPath,
      def,
      violations: parsed.violations,
      resolution,
    });
  }
  return out;
}

const countOf = (groups: TypeGroup[]): number =>
  groups.reduce((n, g) => n + g.entries.reduce((m, e) => m + e.count, 0), 0);

/** Builds the frozen snapshot. Errors in one deck or gauntlet stay on that item. */
export async function buildSnapshot(
  contents: RepoContents,
  lookup: CardLookup,
  opts: BuildOptions,
): Promise<Snapshot> {
  const formats = await resolveGauntletFormats(
    contents,
    opts.presetsDir,
    lookup,
  );
  const allowed = new Map<string, { hasBackFace: boolean }>();
  const usedFormats = new Set<string>();
  const claimed = new Set<Violation>();
  const gauntlets: GauntletEntry[] = [];

  for (const g of contents.gauntlets) {
    const f = formats.find((x) => x.folder === g.folder) as GauntletFormat;
    const errors: Violation[] = [...f.violations];
    const mine = contents.errors.filter(
      (v) => v.file.startsWith(`${g.folder}/`) || v.file === g.folder,
    );
    for (const v of mine) claimed.add(v);
    const entry: GauntletEntry = {
      folder: g.folder,
      def: f.def,
      name: f.def?.name ?? g.folder,
      formatKey: null,
      formatName: null,
      errors,
      descriptionHtml: null,
      deckCount: g.decks.length,
      invalidCount: 0,
      decks: [],
    };
    const descMd = [f.def?.description, g.mdText].filter(
      (s) => s !== undefined && s !== "",
    );
    if (descMd.length > 0)
      entry.descriptionHtml = renderMarkdown(descMd.join("\n\n"));

    const res = f.resolution;
    if (res === null || isFormatFailure(res)) {
      if (res !== null) errors.push(...res.violations);
      entry.invalidCount = g.decks.length;
      errors.push(...mine.filter((v) => !v.file.endsWith(".txt")));
      entry.errors = sortViolations(errors);
      gauntlets.push(entry);
      continue;
    }
    const format = res;
    usedFormats.add(format.key);
    entry.formatKey = format.key;
    const rules: FormatDef | OfficialRules =
      format.ref.kind === "official"
        ? officialRules(format.ref.name)
        : (format.def as FormatDef);
    entry.formatName =
      format.ref.kind === "official"
        ? officialRules(format.ref.name).name
        : (format.def as FormatDef).name;
    errors.push(...mine.filter((v) => !v.file.endsWith(".txt")));

    for (const d of g.decks) {
      const parsed = parseDeck(d.text, d.path);
      const { resolved, violations: vs } = checkDeck(
        parsed,
        rules,
        format.key,
        lookup,
      );
      const violations = sortViolations([
        ...vs,
        ...mine.filter((v) => v.file === d.path),
      ]);
      const errorCount = violations.filter(
        (v) => v.severity === "error",
      ).length;
      const grouping = groupByType(resolved.entries);
      const mtgo = exportMtgo(resolved);
      const dec = exportDec(resolved, { formatName: entry.formatName });
      const mtga = exportMtga(resolved, lookup);
      const proxy = new Map<string, ProxyCard>();
      for (const e of resolved.entries) {
        const p = e.printing;
        if (e.card === null || p === null || p.scryfallId === null) continue;
        allowed.set(p.scryfallId, { hasBackFace: p.hasBackFace });
        if (e.section === "commander") continue;
        const k = p.scryfallId;
        const prev = proxy.get(k);
        if (prev === undefined)
          proxy.set(k, {
            name: e.card.name,
            count: e.count,
            scryfallId: k,
            hasBackFace: p.hasBackFace,
          });
        else proxy.set(k, { ...prev, count: prev.count + e.count });
      }
      const currentPath = `${g.folder}/${d.name}`;
      const deck: DeckEntry = {
        gauntlet: g.folder,
        name: d.name,
        currentPath,
        path: d.path,
        primerPath: d.primer === undefined ? null : `${g.folder}/${d.name}.md`,
        displayName: parsed.frontMatter.name ?? d.name,
        parsed,
        resolved,
        violations,
        errorCount,
        warningCount: violations.length - errorCount,
        valid: errorCount === 0,
        grouping,
        mainCount: countOf(grouping.main),
        sideboardCount: countOf(grouping.sideboard),
        primerHtml: d.primer === undefined ? null : renderMarkdown(d.primer),
        lastUpdated: opts.lastUpdated.get(currentPath) ?? null,
        exports: {
          mtgo: mtgo.text,
          dec: dec.text,
          mtga: mtga.text,
          mtgaUnavailable: [
            ...new Set(
              mtga.warnings
                .map((w) => /^"(.*)" is not available/.exec(w.message)?.[1])
                .filter((n): n is string => n !== undefined),
            ),
          ],
        },
        proxyCards: [...proxy.values()],
      };
      if (!deck.valid) entry.invalidCount++;
      entry.decks.push(deck);
    }
    entry.errors = sortViolations(errors);
    gauntlets.push(entry);
  }

  const snapshot: Snapshot = {
    commit: opts.commit,
    builtAt: (opts.now?.() ?? new Date()).toISOString(),
    mtgjson: opts.mtgjson,
    gauntlets,
    errors: contents.errors.filter((v) => !claimed.has(v)),
    allowedImages: allowed,
    lookup,
    formats: [...usedFormats],
  };
  // The lookup holds an open database, so it is kept out of the freeze.
  const { lookup: keep, ...rest } = snapshot;
  deepFreeze(rest);
  return Object.freeze({ ...rest, lookup: keep });
}

/** An old version of a deck, resolved against the current card data. */
export function resolveOldVersion(
  snap: Snapshot,
  deck: DeckEntry,
  parsed: ParsedDeck,
): ResolvedDeck {
  return resolveDeck(parsed, deck.resolved.formatKey, snap.lookup);
}

let current: Snapshot | null = null;

export const getSnapshot = (): Snapshot | null => current;
export const setSnapshot = (s: Snapshot | null): void => {
  current = s;
};

export const findGauntlet = (
  s: Snapshot,
  folder: string,
): GauntletEntry | undefined => s.gauntlets.find((g) => g.folder === folder);

export const findDeck = (
  g: GauntletEntry,
  name: string,
): DeckEntry | undefined => g.decks.find((d) => d.name === name);
