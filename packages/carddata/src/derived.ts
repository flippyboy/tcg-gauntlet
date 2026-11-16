// The derived file: per-format tables and name indexes, built from one MTGJSON file.
//
// The derived file is the main connection and is opened read-write, with the default
// rollback journal. The MTGJSON file is attached read-only with a `file:` URI, so one
// query can join the two. (If MTGJSON were the main connection, opened read-only, the
// attached derived file would be read-only too.)
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { normalizeName } from "@tcg-gauntlet/engine";
import type { FormatDef, FormatKey } from "@tcg-gauntlet/engine";
import { MtgQueries, registerSqlFunctions } from "./mtgjson-queries.js";

// better-sqlite3 opens connections without URI support unless the SQLITE_USE_URI
// environment variable is "1" when its native module loads, which happens when the
// first connection is created. ATTACH 'file:…?mode=ro' needs it. Setting it here, at
// import time, covers every process that imports this package before it opens any
// SQLite file. openDerived reports a clear error if the setting came too late.
process.env["SQLITE_USE_URI"] ??= "1";

/**
 * Bump this when the derived tables or the rules that fill them change. A derived file
 * with another value is deleted and rebuilt. History: "2" made the Unhinged basics the
 * default printing of the five basic lands.
 */
export const TOOL_SCHEMA = "2";

/** A format to build: its key, and its definition (null for an official format). */
export interface FormatBuild {
  key: FormatKey;
  def: FormatDef | null;
}

export interface OpenDerivedOptions {
  /** `DATA_DIR/derived/<v>-<d>.sqlite`. Created when missing. */
  derivedPath: string;
  /** `DATA_DIR/mtgjson/<v>-<d>/AllPrintings.sqlite`. */
  mtgjsonPath: string;
  /** Faster, less durable writes, for a build whose result is flushed afterwards. */
  bulk?: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS main.meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS main.formats (format_key TEXT PRIMARY KEY, built_at TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS main.format_pool (
  format_key TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (format_key, name)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS main.default_printing (
  format_key TEXT NOT NULL, name TEXT NOT NULL, uuid TEXT NOT NULL, PRIMARY KEY (format_key, name)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS main.card_names (
  norm_name TEXT NOT NULL UNIQUE, name TEXT NOT NULL, face_name TEXT
);
CREATE TABLE IF NOT EXISTS main.card_meta (
  name TEXT PRIMARY KEY, supertypes TEXT, layout TEXT NOT NULL, copy_exempt TEXT
) WITHOUT ROWID;
`;

/** Turns a path into a `file:` URI (the characters `%`, `?` and `#` are escaped). */
export function fileUri(path: string, query = ""): string {
  const escaped = path.replace(/[%?#]/g, (c) => encodeURIComponent(c));
  return `file:${escaped}${query}`;
}

/** Layouts whose faces are halves of one card. A half is not a card name. */
const SPLIT_LAYOUTS = new Set(["split", "aftermath"]);

/** An open derived file with the MTGJSON file attached as `mtg`. */
export class Derived {
  readonly queries: MtgQueries;
  private readonly resolveStmt: Database.Statement;

  private constructor(readonly db: Database.Database) {
    this.queries = new MtgQueries(db);
    this.resolveStmt = db.prepare(
      "SELECT name FROM main.card_names WHERE norm_name = ?",
    );
  }

  /**
   * Opens (creating or rebuilding) the derived file and attaches the MTGJSON file.
   * An existing file whose `tool_schema` differs, or that is not a database, is
   * deleted and started again.
   */
  static open(opts: OpenDerivedOptions): Derived {
    mkdirSync(dirname(opts.derivedPath), { recursive: true });
    let db = Derived.openFile(opts.derivedPath);
    if (!Derived.hasCurrentSchema(db)) {
      db.close();
      for (const suffix of ["", "-journal", "-wal", "-shm"])
        rmSync(opts.derivedPath + suffix, { force: true });
      db = Derived.openFile(opts.derivedPath);
    }
    try {
      db.pragma("cache_size = -65536");
      if (opts.bulk === true) db.pragma("synchronous = OFF");
      db.exec(SCHEMA);
      db.prepare(
        "INSERT OR IGNORE INTO main.meta (key, value) VALUES ('tool_schema', ?)",
      ).run(TOOL_SCHEMA);
      Derived.attach(db, opts.mtgjsonPath);
      registerSqlFunctions(db);
      return new Derived(db);
    } catch (e) {
      db.close();
      throw e;
    }
  }

  private static openFile(path: string): Database.Database {
    return new Database(path);
  }

  /** True for a file made by this tool schema, and for a new empty file. */
  private static hasCurrentSchema(db: Database.Database): boolean {
    try {
      const tables = (
        db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as {
          n: number;
        }
      ).n;
      if (tables === 0) return true;
      const row = db
        .prepare("SELECT value FROM main.meta WHERE key = 'tool_schema'")
        .get() as { value: string } | undefined;
      return row?.value === TOOL_SCHEMA;
    } catch {
      // Not a database, or a table is missing.
      return false;
    }
  }

  private static attach(db: Database.Database, mtgjsonPath: string): void {
    try {
      db.prepare("ATTACH DATABASE ? AS mtg").run(
        fileUri(mtgjsonPath, "?mode=ro"),
      );
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      // A damaged file keeps its SQLite error, so the caller can tell it apart.
      if (
        typeof code === "string" &&
        (code.startsWith("SQLITE_NOTADB") || code.startsWith("SQLITE_CORRUPT"))
      )
        throw e;
      throw new Error(
        `cannot attach ${mtgjsonPath} read-only: ${(e as Error).message}. ` +
          "better-sqlite3 needs SQLITE_USE_URI=1 in the environment before its " +
          "first connection is opened.",
        { cause: e },
      );
    }
    // The attach must really be read-only. A plain-path attach would not be.
    let writable = false;
    try {
      db.exec("CREATE TABLE mtg.tcg_gauntlet_probe (x)");
      writable = true;
    } catch {
      // Expected: attempt to write a readonly database.
    }
    if (writable) {
      db.exec("DROP TABLE mtg.tcg_gauntlet_probe");
      throw new Error(`${mtgjsonPath} was attached read-write`);
    }
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM main.meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO main.meta (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  /** The name that a spelling identifies, or null. */
  resolveName(spelling: string): string | null {
    const row = this.resolveStmt.get(normalizeName(spelling)) as
      { name: string } | undefined;
    return row?.name ?? null;
  }

  /**
   * Fills `card_names`, `card_names_fts` and `card_meta`. It runs once per MTGJSON
   * version: a second call does nothing.
   */
  buildBase(): void {
    if (this.getMeta("base_built") === "1") return;
    const build = this.db.transaction(() => {
      const rows = this.queries.allCardNamesAndFaces();
      const insertFull = this.db.prepare(
        "INSERT OR REPLACE INTO main.card_names (norm_name, name, face_name) VALUES (?, ?, NULL)",
      );
      const insertFace = this.db.prepare(
        "INSERT OR IGNORE INTO main.card_names (norm_name, name, face_name) VALUES (?, ?, ?)",
      );
      // Full names win over face names when two cards claim one spelling.
      for (const name of new Set(rows.map((r) => r.name)))
        insertFull.run(normalizeName(name), name);
      // A front face name identifies its card, except for halves of a split card.
      for (const r of rows) {
        if (
          r.front === 1 &&
          r.faceName !== null &&
          !SPLIT_LAYOUTS.has(r.layout ?? "")
        )
          insertFace.run(normalizeName(r.faceName), r.name, r.faceName);
      }
      this.db.exec(`
        DROP TABLE IF EXISTS main.card_names_fts;
        CREATE VIRTUAL TABLE main.card_names_fts USING fts5(norm_name, tokenize = 'trigram');
        INSERT INTO main.card_names_fts (rowid, norm_name)
          SELECT rowid, norm_name FROM main.card_names;
      `);
      this.queries.insertCardMeta();
      const mtg = this.queries.metaVersion();
      this.setMeta("mtgjson_version", mtg.version ?? "unknown");
      this.setMeta("mtgjson_date", mtg.date ?? "unknown");
      this.setMeta("base_built", "1");
    });
    build();
  }

  hasFormat(key: FormatKey): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM main.formats WHERE format_key = ?")
        .get(key) !== undefined
    );
  }

  formatKeys(): FormatKey[] {
    return (
      this.db
        .prepare("SELECT format_key FROM main.formats ORDER BY format_key")
        .all() as { format_key: string }[]
    ).map((r) => r.format_key);
  }

  /**
   * Builds every format that is not built yet, one transaction per format. A key
   * that is already present is skipped. The base tables must exist (`buildBase`).
   */
  ensureFormats(formats: readonly FormatBuild[]): void {
    this.buildBase();
    for (const f of formats) {
      if (this.hasFormat(f.key)) continue;
      this.db.transaction(() => this.buildFormat(f))();
    }
  }

  private buildFormat({ key, def }: FormatBuild): void {
    if (key.startsWith("official:")) {
      // Legality comes from MTGJSON, so there is no pool. Any set can supply the
      // default printing.
      this.queries.insertUnhingedBasics(key);
      this.queries.insertDefaultPrinting(key, null);
    } else {
      if (def === null) throw new Error(`format ${key} needs its definition`);
      const full = (names: readonly string[]): string => {
        const out = new Set<string>();
        for (const n of names) {
          const r = this.resolveName(n);
          if (r !== null) out.add(r);
        }
        return JSON.stringify([...out]);
      };
      const sets = JSON.stringify(def.sets);
      this.queries.insertPool(
        key,
        sets,
        full(def.include.map((o) => o.name)),
        full(def.exclude.map((o) => o.name)),
        full(def.banned),
      );
      this.queries.insertUnhingedBasics(key);
      this.queries.insertDefaultPrinting(key, sets);
      this.queries.insertDefaultPrinting(key, null);
    }
    this.db
      .prepare(
        "INSERT INTO main.formats (format_key, built_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      )
      .run(key);
  }

  /** Deletes every format whose key is not in `keepKeys`. */
  pruneFormats(keepKeys: readonly FormatKey[]): void {
    const keep = JSON.stringify(keepKeys);
    this.db.transaction(() => {
      for (const table of ["format_pool", "default_printing", "formats"]) {
        this.db
          .prepare(
            `DELETE FROM main.${table} WHERE format_key NOT IN (SELECT value FROM json_each(?))`,
          )
          .run(keep);
      }
    })();
  }
}

export const openDerived = (opts: OpenDerivedOptions): Derived =>
  Derived.open(opts);
