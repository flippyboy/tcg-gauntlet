// The refresh cycle and the way to open what it produced.
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CardDataError } from "./errors.js";
import {
  type CacheEntry,
  type CurrentIndex,
  derivedPath,
  entryFor,
  markCorrupt,
  moveAtomic,
  mtgjsonPath,
  promote,
  readCurrent,
  tmpRoot,
  verifyCurrent,
} from "./cache.js";
import { Derived, type FormatBuild, fileUri } from "./derived.js";
import {
  type RequestOptions,
  downloadAllPrintings,
  fetchMeta,
} from "./download.js";
import { SqliteCardLookup } from "./lookup.js";
import { selfCheck } from "./self-check.js";

export interface RefreshOptions extends RequestOptions {
  /** `MTGJSON_BASE_URL`, for example `https://mtgjson.com/api/v5`. */
  baseUrl: string;
  /** `DATA_DIR`. */
  dataDir: string;
  /** The formats in use. The new derived file is built for exactly these. */
  formatDefs?: readonly FormatBuild[];
  /** Download again even when `Meta.json` shows the cached version. */
  force?: boolean;
  /** Self-check minimum of distinct card names. Default 20,000. */
  minCards?: number;
}

export interface RefreshResult {
  status: "updated" | "unchanged" | "failed";
  error?: CardDataError;
  /** The version in use after the refresh. Null when there is none. */
  current: CurrentIndex | null;
}

const fileExists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Runs the self-check on a file that is not in the cache yet. */
function selfCheckFile(path: string, minCards: number | undefined): string[] {
  const db = new Database(":memory:");
  try {
    // Derived.attach is not used here: this connection has no derived file.
    db.prepare("ATTACH DATABASE ? AS mtg").run(fileUri(path, "?mode=ro"));
    return selfCheck(db, minCards === undefined ? {} : { minCards });
  } catch (e) {
    return [`cannot open the file as a database: ${(e as Error).message}`];
  } finally {
    db.close();
  }
}

/**
 * The refresh cycle:
 *
 * 1. Fetch `Meta.json`. If its version and date match the current entry, stop.
 * 2. Download `AllPrintings.sqlite.gz`, unpack it, check both checksums.
 * 3. Open the file read-only and run the self-check.
 * 4. Build the derived file for every format in use, against the new file.
 * 5. Move both files into place and rewrite `current.json` in one atomic step. Keep
 *    the previous version, and delete anything older.
 * 6. On any failure, the current version stays in use, and `error` says why.
 *
 * It assumes one refresh runs at a time per data directory.
 */
export async function refreshCardData(
  opts: RefreshOptions,
): Promise<RefreshResult> {
  const { dataDir } = opts;
  let current: CurrentIndex | null = null;
  try {
    current = await readCurrent(dataDir);
  } catch {
    // A damaged index counts as no data.
  }
  const requestOpts: RequestOptions = {
    ...(opts.userAgent === undefined ? {} : { userAgent: opts.userAgent }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  };
  let tmpDir: string | null = null;
  try {
    const meta = await fetchMeta(opts.baseUrl, requestOpts);
    if (
      opts.force !== true &&
      current !== null &&
      current.corrupt !== true &&
      current.version === meta.version &&
      current.date === meta.date &&
      (await fileExists(mtgjsonPath(dataDir, current)))
    ) {
      return { status: "unchanged", current };
    }

    // Leftovers of an interrupted refresh.
    await rm(tmpRoot(dataDir), { recursive: true, force: true });
    await mkdir(tmpRoot(dataDir), { recursive: true });
    tmpDir = await mkdtemp(join(tmpRoot(dataDir), "refresh-"));

    const dl = await downloadAllPrintings(opts.baseUrl, tmpDir, requestOpts);

    const problems = selfCheckFile(dl.path, opts.minCards);
    if (problems.length > 0) {
      throw new CardDataError(
        "self-check",
        `MTGJSON ${meta.version} failed the self-check: ${problems.join("; ")}`,
      );
    }

    const entry = entryFor(meta.version, meta.date, dl.sha256);
    const derivedTmp = join(tmpDir, "derived.sqlite");
    try {
      const derived = Derived.open({
        derivedPath: derivedTmp,
        mtgjsonPath: dl.path,
        bulk: true,
      });
      try {
        derived.buildBase();
        derived.ensureFormats(opts.formatDefs ?? []);
      } finally {
        derived.close();
      }
      await moveAtomic(dl.path, mtgjsonPath(dataDir, entry));
      await moveAtomic(derivedTmp, derivedPath(dataDir, entry));
      return {
        status: "updated",
        current: await promote(dataDir, entry),
      };
    } catch (e) {
      if (e instanceof CardDataError) throw e;
      throw new CardDataError(
        "build",
        `building the card data failed: ${(e as Error).message}`,
        { cause: e },
      );
    }
  } catch (e) {
    const error =
      e instanceof CardDataError
        ? e
        : new CardDataError("build", (e as Error).message, { cause: e });
    return { status: "failed", error, current };
  } finally {
    if (tmpDir !== null) await rm(tmpDir, { recursive: true, force: true });
  }
}

export interface OpenCurrentOptions {
  /** Formats to build in the derived file when they are missing. */
  formatDefs?: readonly FormatBuild[];
  /** Recompute the checksum of the MTGJSON file first. Default true. */
  verifyChecksum?: boolean;
}

export type OpenCurrentResult =
  | { ok: true; lookup: SqliteCardLookup; current: CurrentIndex }
  | { ok: false; reason: "no-data" | "corrupt" };

const isDamage = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    (code.startsWith("SQLITE_CORRUPT") || code.startsWith("SQLITE_NOTADB"))
  );
};

/**
 * Opens the current cached version. This is the startup path: it checks the file's
 * checksum, which marks a bad file corrupt in `current.json` so that the next
 * refresh replaces it. A derived file that is missing or from another tool schema
 * is rebuilt here.
 */
export async function openCurrent(
  dataDir: string,
  opts: OpenCurrentOptions = {},
): Promise<OpenCurrentResult> {
  let current: CurrentIndex | null;
  try {
    current = await readCurrent(dataDir);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (current === null) return { ok: false, reason: "no-data" };
  if (current.corrupt === true) return { ok: false, reason: "corrupt" };
  if (opts.verifyChecksum !== false) {
    const verdict = await verifyCurrent(dataDir, current);
    if (!verdict.ok) return { ok: false, reason: "corrupt" };
  } else if (!(await fileExists(mtgjsonPath(dataDir, current)))) {
    return { ok: false, reason: "corrupt" };
  }
  let derived: Derived | null = null;
  try {
    derived = Derived.open({
      derivedPath: derivedPath(dataDir, current),
      mtgjsonPath: mtgjsonPath(dataDir, current),
    });
    derived.buildBase();
    derived.ensureFormats(opts.formatDefs ?? []);
    return { ok: true, lookup: new SqliteCardLookup(derived), current };
  } catch (e) {
    derived?.close();
    if (isDamage(e)) {
      await markCorrupt(dataDir);
      return { ok: false, reason: "corrupt" };
    }
    throw e;
  }
}

export type { CacheEntry };
