// Every SQL statement that names an MTGJSON table or column lives in this module.
// A schema change in a new MTGJSON release then breaks only this file, and the
// self-check (self-check.ts) reports the break at refresh time.
//
// All statements read the MTGJSON file through the attached schema `mtg`. The
// derived file is the main schema, so writes go to `main.<table>`.
//
// MTGJSON stores a boolean flag as NULL when it is false. Every flag test is
// written COALESCE(<flag>, 0).
import type Database from "better-sqlite3";
import { OFFICIAL_FORMAT_NAMES, legalityColumn } from "@tcg-gauntlet/engine";
import type { OfficialFormatName } from "@tcg-gauntlet/engine";

/** The tables and columns the queries below use. The self-check looks for them. */
export const REQUIRED_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  cards: [
    "uuid",
    "name",
    "faceName",
    "side",
    "layout",
    "setCode",
    "number",
    "language",
    "availability",
    "isFunny",
    "isOnlineOnly",
    "isOversized",
    "isPromo",
    "originalReleaseDate",
    "supertypes",
    "types",
    "text",
    "manaValue",
  ],
  sets: ["code", "type", "releaseDate"],
  cardLegalities: [
    "uuid",
    ...OFFICIAL_FORMAT_NAMES.map((n) => legalityColumn(n)),
  ],
  cardIdentifiers: ["uuid", "scryfallId"],
  meta: ["date", "version"],
};

/** The rows of one card name, as the CardRef needs them. */
export interface CardRow {
  uuid: string;
  name: string;
  faceName: string | null;
  side: string | null;
  types: string | null;
  manaValue: number | null;
}

export interface PrintingRow {
  uuid: string;
  name: string;
  setCode: string;
  number: string;
  scryfallId: string | null;
  /** Release date of the printing's set. */
  releaseDate: string | null;
  availability: string | null;
  layout: string | null;
}

export interface NameRow {
  name: string;
  faceName: string | null;
  layout: string | null;
  front: number;
}

/** The first run of ASCII digits of a collector number, as a number. */
function numericPart(number: unknown): number {
  const m = /[0-9]+/.exec(typeof number === "string" ? number : "");
  // No digits sorts last, like infinity.
  return m ? Number(m[0]) : 1e300;
}

/**
 * Registers the SQL functions the queries use. Call once per connection, before
 * preparing a statement.
 */
export function registerSqlFunctions(db: Database.Database): void {
  db.function("tcg_num_part", { deterministic: true }, numericPart);
}

// ------------------------------------------------------------------ fragments

const FRONT = "(c.side IS NULL OR c.side = 'a')";
/** An exact element of a comma-separated list column. */
const hasItem = (column: string, item: string): string =>
  `INSTR(',' || REPLACE(COALESCE(${column}, ''), ' ', '') || ',', ',${item},') > 0`;
const POOL_PRINTING =
  "COALESCE(c.isFunny, 0) = 0 AND COALESCE(c.isOnlineOnly, 0) = 0 AND COALESCE(c.isOversized, 0) = 0";
/** The release date used for ordering: the original one when present. */
const DATE = "COALESCE(c.originalReleaseDate, s.releaseDate, '')";
/** Core and expansion sets rank before all others. */
const SET_RANK = "CASE WHEN s.type IN ('core', 'expansion') THEN 0 ELSE 1 END";
const NUMBER_ORDER = "tcg_num_part(c.number), c.number, c.uuid";

const PRINTING_COLUMNS = `c.uuid, c.name, c.setCode, c.number, i.scryfallId,
  s.releaseDate, c.availability, c.layout`;
const PRINTING_FROM = `FROM mtg.cards c
  LEFT JOIN mtg.cardIdentifiers i ON i.uuid = c.uuid
  LEFT JOIN mtg.sets s ON s.code = c.setCode`;

/** Prepared statements over the attached MTGJSON schema. */
export class MtgQueries {
  private readonly cache = new Map<string, Database.Statement>();

  constructor(private readonly db: Database.Database) {}

  private stmt(sql: string): Database.Statement {
    let s = this.cache.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  /** `meta` of the MTGJSON file: its version and date. */
  metaVersion(): { version: string | null; date: string | null } {
    const row = this.stmt(
      "SELECT version, date FROM mtg.meta LIMIT 1",
    ).get() as { version: string | null; date: string | null } | undefined;
    return row ?? { version: null, date: null };
  }

  /** Every row of a card (all faces, all printings), in uuid order. */
  printingsByName(name: string): CardRow[] {
    return this.stmt(
      `SELECT c.uuid, c.name, c.faceName, c.side, c.types, c.manaValue
       FROM mtg.cards c WHERE c.name = ? ORDER BY c.uuid`,
    ).all(name) as CardRow[];
  }

  printingByUuid(uuid: string): PrintingRow | null {
    return (
      (this.stmt(
        `SELECT ${PRINTING_COLUMNS} ${PRINTING_FROM} WHERE c.uuid = ?`,
      ).get(uuid) as PrintingRow | undefined) ?? null
    );
  }

  private bySetNumber(
    set: string,
    number: string | null,
    name: string,
  ): PrintingRow | null {
    // Front-face rows only. English first, then the lowest collector number.
    return (
      (this.stmt(
        `SELECT ${PRINTING_COLUMNS} ${PRINTING_FROM}
         WHERE c.name = @name AND LOWER(c.setCode) = @set AND ${FRONT}
           AND (@number IS NULL OR LOWER(c.number) = @number)
         ORDER BY COALESCE(c.language = 'English', 0) DESC, ${NUMBER_ORDER}
         LIMIT 1`,
      ).get({
        name,
        set: set.toLowerCase(),
        number: number === null ? null : number.toLowerCase(),
      }) as PrintingRow | undefined) ?? null
    );
  }

  /** The printing of `name` in `set` with this collector number. */
  printingBySetNumber(
    set: string,
    number: string,
    name: string,
  ): PrintingRow | null {
    return this.bySetNumber(set, number, name);
  }

  /** The printing of `name` in `set` with the lowest collector number. */
  lowestNumberInSet(set: string, name: string): PrintingRow | null {
    return this.bySetNumber(set, null, name);
  }

  /**
   * The Arena printing: of the front-face English printings that are on Arena, the
   * newest by release date, then the default printing's tie-breaks.
   */
  arenaPrinting(name: string): PrintingRow | null {
    return (
      (this.stmt(
        `SELECT ${PRINTING_COLUMNS} ${PRINTING_FROM}
         WHERE c.name = ? AND ${hasItem("c.availability", "arena")}
           AND ${FRONT} AND c.language = 'English'
         ORDER BY ${DATE} DESC, ${SET_RANK}, ${NUMBER_ORDER}
         LIMIT 1`,
      ).get(name) as PrintingRow | undefined) ?? null
    );
  }

  /**
   * The distinct legality values of all rows of a card in one official format.
   * NULL values are left out. The caller combines the rest.
   */
  officialLegality(format: OfficialFormatName, name: string): string[] {
    const column = OFFICIAL_FORMAT_NAMES.includes(format)
      ? legalityColumn(format)
      : null;
    if (column === null) throw new Error(`not an official format: ${format}`);
    const rows = this.stmt(
      `SELECT DISTINCT l."${column}" AS v
       FROM mtg.cards c JOIN mtg.cardLegalities l ON l.uuid = c.uuid
       WHERE c.name = ? AND l."${column}" IS NOT NULL`,
    ).all(name) as { v: string }[];
    return rows.map((r) => r.v);
  }

  /**
   * Fills the pool of a custom format: every card with a pool printing in `sets`,
   * plus `include`, minus `exclude` and `banned`. The three name lists hold full
   * MTGJSON names, already resolved by the caller.
   */
  insertPool(
    formatKey: string,
    setsJson: string,
    includeJson: string,
    excludeJson: string,
    bannedJson: string,
  ): void {
    this.stmt(
      `INSERT INTO main.format_pool (format_key, name)
       SELECT @key, n.name FROM (
         SELECT c.name FROM mtg.cards c
         WHERE c.setCode IN (SELECT value FROM json_each(@sets)) AND ${POOL_PRINTING}
         UNION
         SELECT value FROM json_each(@include)
       ) n
       WHERE n.name NOT IN (SELECT value FROM json_each(@exclude))
         AND n.name NOT IN (SELECT value FROM json_each(@banned))`,
    ).run({
      key: formatKey,
      sets: setsJson,
      include: includeJson,
      exclude: excludeJson,
      banned: bannedJson,
    });
  }

  /**
   * Fills the default printing of every card that has none yet under `formatKey`.
   * With `setsJson`, only printings in those sets qualify. With null, any set.
   * A custom format calls this twice: with its sets, then with null, so a card no
   * listed set prints (an included card) falls back to a printing from any set.
   */
  insertDefaultPrinting(formatKey: string, setsJson: string | null): void {
    this.stmt(
      `INSERT INTO main.default_printing (format_key, name, uuid)
       SELECT @key, name, uuid FROM (
         SELECT c.name, c.uuid,
           ROW_NUMBER() OVER (
             PARTITION BY c.name
             ORDER BY (COALESCE(c.isPromo, 0) <> 0), ${DATE}, ${SET_RANK}, ${NUMBER_ORDER}
           ) AS rn
         FROM mtg.cards c LEFT JOIN mtg.sets s ON s.code = c.setCode
         WHERE ${hasItem("c.availability", "paper")}
           AND ${POOL_PRINTING}
           AND ${FRONT} AND c.language = 'English'
           AND (@sets IS NULL OR c.setCode IN (SELECT value FROM json_each(@sets)))
           AND c.name NOT IN (SELECT name FROM main.default_printing WHERE format_key = @key)
       ) WHERE rn = 1`,
    ).run({ key: formatKey, sets: setsJson });
  }

  /**
   * Per card name: the supertypes and layout of its front face, and whether the
   * copy limit is lifted (`basic`, or `any_number` from the rules text). The
   * `hasAlternativeDeckLimit` column is not used, because it also marks cards with
   * a different limit, such as Nazgul and Seven Dwarves.
   */
  insertCardMeta(): void {
    this.stmt(
      `INSERT INTO main.card_meta (name, supertypes, layout, copy_exempt)
       SELECT name, supertypes, layout,
         CASE WHEN basic THEN 'basic' WHEN any_number THEN 'any_number' END
       FROM (
         SELECT c.name, c.supertypes, COALESCE(c.layout, 'normal') AS layout,
           ${hasItem("c.supertypes", "Basic")} AS basic,
           MAX(INSTR(COALESCE(c.text, ''), 'A deck can have any number of cards named') > 0)
             OVER (PARTITION BY c.name) AS any_number,
           ROW_NUMBER() OVER (
             PARTITION BY c.name
             ORDER BY CASE WHEN ${FRONT} THEN 0 ELSE 1 END, c.uuid
           ) AS rn
         FROM mtg.cards c
       ) WHERE rn = 1`,
    ).run();
  }

  /** Every distinct name, with the face name and layout of its rows. */
  allCardNamesAndFaces(): NameRow[] {
    return this.stmt(
      `SELECT DISTINCT c.name, c.faceName, c.layout,
         CASE WHEN ${FRONT} THEN 1 ELSE 0 END AS front
       FROM mtg.cards c ORDER BY c.name`,
    ).all() as NameRow[];
  }

  /** The number of distinct card names. */
  cardCount(): number {
    const row = this.stmt(
      "SELECT COUNT(DISTINCT name) AS n FROM mtg.cards",
    ).get() as { n: number };
    return row.n;
  }
}
