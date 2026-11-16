// The disk cache under DATA_DIR:
//
//   mtgjson/<v>-<d>/AllPrintings.sqlite   the card data; <v> has '+' turned into '_'
//   mtgjson/current.json                  the index
//   derived/<v>-<d>.sqlite                the derived file of that version
//   tmp/                                  downloads in progress
//
// Every file this package writes goes through a temporary file, fsync, rename on
// the same filesystem, and an fsync of the directory.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** One cached MTGJSON version. `path` is relative to the data directory. */
export interface CacheEntry {
  version: string;
  date: string;
  sha256: string;
  path: string;
}

/** `current.json`. `corrupt` is set when the startup check found a bad file. */
export interface CurrentIndex extends CacheEntry {
  previous: CacheEntry | null;
  corrupt?: true;
}

export const MTGJSON_FILE = "AllPrintings.sqlite";

const mtgjsonDir = (dataDir: string): string => join(dataDir, "mtgjson");
const indexPath = (dataDir: string): string =>
  join(mtgjsonDir(dataDir), "current.json");

/** The directory name of a version: `5.3.0+20261115` and `2026-11-15` give `5.3.0_20261115-2026-11-15`. */
export function versionDirName(version: string, date: string): string {
  return `${version.replaceAll("+", "_")}-${date}`;
}

export function entryFor(
  version: string,
  date: string,
  sha256: string,
): CacheEntry {
  return {
    version,
    date,
    sha256,
    path: `mtgjson/${versionDirName(version, date)}/${MTGJSON_FILE}`,
  };
}

/** Absolute path of the MTGJSON file of an entry. */
export const mtgjsonPath = (dataDir: string, e: CacheEntry): string =>
  join(dataDir, e.path);

/** Absolute path of the derived file of an entry. */
export const derivedPath = (dataDir: string, e: CacheEntry): string =>
  join(dataDir, "derived", `${versionDirName(e.version, e.date)}.sqlite`);

export const tmpRoot = (dataDir: string): string => join(dataDir, "tmp");

// ------------------------------------------------------------- atomic writes

/** Flushes a directory's entries (renames, creations) to disk. */
export async function fsyncDir(dir: string): Promise<void> {
  const fh = await open(dir, "r");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Flushes an existing file to disk. */
export async function fsyncFile(path: string): Promise<void> {
  const fh = await open(path, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Writes a file atomically: temporary file, fsync, rename, fsync of the directory. */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
  await fsyncDir(dir);
}

/** Moves a finished file into place, on the same filesystem, and flushes it. */
export async function moveAtomic(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await fsyncFile(from);
  await rename(from, to);
  await fsyncDir(dirname(to));
}

// ---------------------------------------------------------------- the index

const isEntry = (v: unknown): v is CacheEntry => {
  const e = v as Partial<CacheEntry> | null;
  return (
    typeof e?.version === "string" &&
    typeof e.date === "string" &&
    typeof e.sha256 === "string" &&
    typeof e.path === "string"
  );
};

/** Reads `current.json`. Null when there is none. Throws on a damaged index. */
export async function readCurrent(
  dataDir: string,
): Promise<CurrentIndex | null> {
  let text: string;
  try {
    text = await readFile(indexPath(dataDir), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const parsed: unknown = JSON.parse(text);
  const v = parsed as Partial<CurrentIndex>;
  if (
    !isEntry(parsed) ||
    (v.previous !== null && v.previous !== undefined && !isEntry(v.previous))
  ) {
    throw new Error("current.json has an unexpected shape");
  }
  const out: CurrentIndex = {
    version: parsed.version,
    date: parsed.date,
    sha256: parsed.sha256,
    path: parsed.path,
    previous: v.previous ?? null,
  };
  if (v.corrupt === true) out.corrupt = true;
  return out;
}

async function writeCurrent(
  dataDir: string,
  index: CurrentIndex,
): Promise<void> {
  await writeFileAtomic(
    indexPath(dataDir),
    `${JSON.stringify(index, null, 2)}\n`,
  );
}

/**
 * Makes `entry` the current version in one atomic step. The old current version
 * becomes `previous`, unless it is the same version (a re-download after the file
 * went bad), which keeps the old `previous`. Then everything but the two versions
 * is deleted.
 */
export async function promote(
  dataDir: string,
  entry: CacheEntry,
): Promise<CurrentIndex> {
  const old = await readCurrent(dataDir).catch(() => null);
  let previous: CacheEntry | null = null;
  if (old !== null) {
    previous =
      old.path === entry.path
        ? old.previous
        : {
            version: old.version,
            date: old.date,
            sha256: old.sha256,
            path: old.path,
          };
  }
  const next: CurrentIndex = { ...entry, previous };
  await writeCurrent(dataDir, next);
  await applyRetention(dataDir, next);
  return next;
}

/** Marks the current file as bad, so the next refresh replaces it. */
export async function markCorrupt(
  dataDir: string,
): Promise<CurrentIndex | null> {
  const cur = await readCurrent(dataDir);
  if (cur === null) return null;
  const next: CurrentIndex = { ...cur, corrupt: true };
  await writeCurrent(dataDir, next);
  return next;
}

/** Deletes every cached version and derived file except the current and previous ones. */
export async function applyRetention(
  dataDir: string,
  index: CurrentIndex,
): Promise<void> {
  const keep = [index, index.previous].filter((e) => e !== null);
  const keepDirs = new Set(keep.map((e) => versionDirName(e.version, e.date)));
  const sweep = async (
    dir: string,
    keepName: (name: string) => boolean,
  ): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const name of names) {
      if (!keepName(name))
        await rm(join(dir, name), { recursive: true, force: true });
    }
  };
  await sweep(
    mtgjsonDir(dataDir),
    (n) => n === "current.json" || n.startsWith(".") || keepDirs.has(n),
  );
  await sweep(join(dataDir, "derived"), (n) => {
    // The derived file, and the journal SQLite keeps beside it while it is open.
    const base = n.replace(/-journal$/, "");
    return keepDirs.has(base.replace(/\.sqlite$/, ""));
  });
}

// ----------------------------------------------------------------- checksums

/** SHA-256 of a file, lower-case hex, streamed. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: "missing" | "mismatch" };

/**
 * The startup check: recomputes the checksum of the current file. A mismatch (or a
 * missing file) marks the current version corrupt in `current.json`, so that the
 * next refresh replaces it.
 */
export async function verifyCurrent(
  dataDir: string,
  index: CurrentIndex,
): Promise<VerifyResult> {
  const file = mtgjsonPath(dataDir, index);
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  let result: VerifyResult = { ok: true };
  if (!exists) result = { ok: false, reason: "missing" };
  else if ((await sha256File(file)) !== index.sha256)
    result = { ok: false, reason: "mismatch" };
  if (!result.ok && index.corrupt !== true) await markCorrupt(dataDir);
  return result;
}
