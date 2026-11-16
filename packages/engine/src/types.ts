// Shared types for the engine. Everything here is plain data, so results can be
// serialised and compared.

// ---------------------------------------------------------------- violations

export type ErrorCode =
  | "E-PARSE-LINE"
  | "E-PARSE-FRONTMATTER"
  | "E-SCHEMA-VERSION"
  | "E-SCHEMA-INVALID"
  | "E-CARD-UNKNOWN"
  | "E-PRINTING-UNKNOWN"
  | "E-LEGAL-BANNED"
  | "E-LEGAL-NOT-IN-POOL"
  | "E-LEGAL-RESTRICTED"
  | "E-DECK-MAIN-SIZE"
  | "E-DECK-SIDEBOARD-SIZE"
  | "E-DECK-COPIES"
  | "E-DECK-SECTION"
  | "E-FORMAT-UNKNOWN"
  | "E-FORMAT-INVALID"
  | "E-LIMIT-EXCEEDED"
  | "W-FRONTMATTER-UNKNOWN-FIELD"
  | "W-PRIMER-ORPHAN"
  | "W-MTGA-UNAVAILABLE"
  | "W-STALE-DATA";

export type Severity = "error" | "warning";

export interface Violation {
  code: ErrorCode;
  severity: Severity;
  /** Path relative to the deck repo root (or whatever the caller passed in). */
  file: string;
  /** 1-based line, counted from the first line of the file. */
  line?: number;
  message: string;
  suggestion?: string;
}

// ------------------------------------------------------------------- parsing

/**
 * `commander` is not in the design's `main | sideboard`. The spec says cards in a
 * Commander section are read but count in neither the main deck nor the sideboard,
 * so they need their own marker.
 */
export type Section = "main" | "sideboard" | "commander";

export interface ParsedLine {
  /** 1-based line number in the file. */
  line: number;
  count: number;
  /** The card name exactly as written. */
  rawName: string;
  /** Magic Workstation `[SET]` hint. Not set when the brackets are empty. */
  hint?: string;
  /** Set code as written (any letter case). */
  set?: string;
  /** Collector number as written. */
  number?: string;
  section: Section;
}

export interface FrontMatter {
  schema_version?: number;
  name?: string;
  author?: string;
  archetype?: string;
  description?: string;
  tags?: string[];
  source?: string;
}

export interface ParsedDeck {
  path: string;
  frontMatter: FrontMatter;
  lines: ParsedLine[];
  /** Line numbers of `Commander` section headers (each gives E-DECK-SECTION). */
  commanderHeaderLines: number[];
  warnings: Violation[];
  parseErrors: Violation[];
  schemaVersion: number;
}

// --------------------------------------------------------------- definitions

export interface GauntletDef {
  schema_version: number;
  name: string;
  format: string;
  description?: string;
}

export type OfficialFormatName =
  "standard" | "pioneer" | "modern" | "legacy" | "vintage" | "pauper";

export type CopyExempt = "basic_lands" | "any_number_text";

export interface DeckRules {
  min_main: number;
  max_main?: number;
  max_sideboard: number;
  max_copies: number;
  copy_exempt: CopyExempt[];
}

export interface Override {
  name: string;
  reason: string;
}

/** A custom format definition with all defaults filled in. */
export interface FormatDef {
  schema_version: number;
  id: string;
  name: string;
  legality_by: "name";
  sets: string[];
  banned: string[];
  restricted: string[];
  include: Override[];
  exclude: Override[];
  deck: DeckRules;
}

/** The rules of an official format. Legality comes from MTGJSON. */
export interface OfficialRules {
  official: OfficialFormatName;
  name: string;
  deck: DeckRules;
}

export type FormatRef =
  | { kind: "preset"; ref: string; id: string; revision: number }
  | { kind: "repo"; ref: string; path: string }
  | { kind: "official"; ref: string; name: OfficialFormatName };

/** `<ref>#<hash12>` or `<ref>#mtgjson`. */
export type FormatKey = string;

// -------------------------------------------------------------- card lookup

export interface CardRef {
  /** The full MTGJSON name, for example `Wear // Tear`. */
  name: string;
  oracleKey: string;
  types: string[];
  supertypes: string[];
  layout: string;
  manaValue: number;
  faces: { name: string; side: string }[];
  copyExempt: "basic" | "any_number" | null;
}

export interface PrintingRef {
  uuid: string;
  cardName: string;
  /** MTGJSON set code, upper case. */
  set: string;
  number: string;
  scryfallId: string | null;
  /** Release date of the printing's set, `YYYY-MM-DD`. */
  releasedAt: string | null;
  availability: string[];
  hasBackFace: boolean;
}

/**
 * `banned` is the MTGJSON value `Banned`. The design lists only legal, restricted
 * and not_legal, but the spec needs to tell `Banned` from the other not-legal
 * values (E-LEGAL-BANNED against E-LEGAL-NOT-IN-POOL).
 */
export type OfficialLegality = "legal" | "restricted" | "banned" | "not_legal";

export interface CardLookup {
  /** Finds a card by any accepted spelling of its name (see normalizeName). */
  findCard(name: string): CardRef | null;
  /**
   * The printing of `cardName` in `set` (letter case ignored). With a number, the
   * printing with that number. Without one, the lowest number. Null when it does
   * not exist or belongs to a different card.
   */
  findPrinting(
    set: string,
    number: string | undefined,
    cardName: string,
  ): PrintingRef | null;
  /** Pool membership for a custom format. Banned cards are not in the pool. */
  inPool(formatKey: FormatKey, card: CardRef): boolean;
  officialLegality(format: OfficialFormatName, card: CardRef): OfficialLegality;
  defaultPrinting(formatKey: FormatKey, card: CardRef): PrintingRef | null;
  /**
   * The printing the MTGA export uses for a line without a set code: of the
   * card's front-face English printings that are on Arena, the newest by release
   * date (the original release date if there is one, else the set's), then the
   * default printing's tie-breaks. Null when no printing is on Arena.
   */
  arenaPrinting(card: CardRef): PrintingRef | null;
  suggest(name: string, limit: number): string[];
  dataVersion(): string;
  /**
   * Optional. A lookup that builds per-format tables (pool, default printing)
   * builds them here. Callers call it before `inPool` or `defaultPrinting` for a
   * custom format key. Official format keys need no registration.
   */
  registerFormat?(formatKey: FormatKey, def: FormatDef): void;
}

// ------------------------------------------------------------------- results

export interface ResolvedEntry {
  line: ParsedLine;
  count: number;
  section: Section;
  /** Null when the name matches no card. */
  card: CardRef | null;
  /** Null when the card has no default printing, or the card is unknown. */
  printing: PrintingRef | null;
  /** True when the printing came from the deck line (set code or usable hint). */
  explicitPrinting: boolean;
}

export interface ResolvedDeck {
  parsed: ParsedDeck;
  formatKey: FormatKey;
  entries: ResolvedEntry[];
  /** E-CARD-UNKNOWN and E-PRINTING-UNKNOWN. */
  violations: Violation[];
}

export interface DiffEntry {
  kind: "removed" | "added" | "count" | "printing";
  section: Section;
  name: string;
  from?: number | string;
  to?: number | string;
}

export interface ExportResult {
  text: string;
  warnings: Violation[];
}

export interface ExportOptions {
  /** Display name of the format, for the `.dec` header. */
  formatName?: string;
}
