// The schema and low-level reads and writes of `history.sqlite`.
//
// `@tcg-gauntlet/carddata` must be imported before any other SQLite use: importing
// it sets SQLITE_USE_URI=1, which better-sqlite3 reads when its native module loads
// (on the first connection). This file is the first module of the app that opens a
// database, so the import comes first. ES modules evaluate imports in order.
import "@tcg-gauntlet/carddata";
import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import type {
  DeckRow,
  DeckVersionRow,
  HistoryKind,
  HistoryState,
  HistoryStatus,
} from "@tcg-gauntlet/repo";

export type Db = Database.Database;

/** Bump this when the tables change. A file with another value is rebuilt. */
export const HISTORY_SCHEMA = "1";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS decks (
  deck_id INTEGER PRIMARY KEY,
  current_path TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS deck_versions (
  deck_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('txt', 'md')),
  status TEXT NOT NULL CHECK (status IN ('A', 'M', 'D', 'R')),
  commit_sha TEXT NOT NULL,
  blob_sha TEXT,
  path_at_commit TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_date TEXT NOT NULL,
  author_ts INTEGER NOT NULL,
  committer_date TEXT NOT NULL,
  subject TEXT NOT NULL,
  PRIMARY KEY (deck_id, seq, kind)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS deck_versions_commit ON deck_versions (commit_sha);
`;

/** Opens a history database and creates its tables. Throws if it is damaged. */
export function openHistoryDb(path: string): Db {
  const db = new Database(path);
  try {
    db.exec(SCHEMA);
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'tool_schema'")
      .get() as { value: string } | undefined;
    if (row === undefined) {
      db.prepare("INSERT INTO meta (key, value) VALUES ('tool_schema', ?)").run(
        HISTORY_SCHEMA,
      );
    } else if (row.value !== HISTORY_SCHEMA) {
      throw new Error(
        `history.sqlite has tool_schema ${row.value}, expected ${HISTORY_SCHEMA}`,
      );
    }
    db.prepare("SELECT count(*) FROM deck_versions").get();
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

/** Deletes a database file and its journal. */
export function removeDbFiles(path: string): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"])
    rmSync(`${path}${suffix}`, { force: true });
}

export function getState(db: Db, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setState(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/** What `applyHistory` needs from the database. */
export function readHistoryState(db: Db): HistoryState {
  const live = db
    .prepare(
      "SELECT deck_id, current_path FROM decks WHERE current_path IS NOT NULL",
    )
    .all() as { deck_id: number; current_path: string }[];
  const max = db.prepare("SELECT max(deck_id) AS m FROM decks").get() as {
    m: number | null;
  };
  return {
    lastSeq: Number(getState(db, "last_seq") ?? 0),
    maxDeckId: max.m ?? 0,
    liveDecks: live.map((r) => ({
      deckId: r.deck_id,
      currentPath: r.current_path,
    })),
  };
}

export interface HistoryWrite {
  decks: readonly (DeckRow & { created: boolean })[];
  versions: readonly DeckVersionRow[];
  lastSeq: number;
  lastCommit: string;
}

/**
 * Writes the result of `applyHistory` in one transaction. `applyHistory` returns the
 * final `current_path` of each deck it touched. A deck may take a path another deck
 * in the same batch gives up, so every touched deck's path is set to NULL first.
 */
export function writeHistory(db: Db, w: HistoryWrite): void {
  const nullPath = db.prepare(
    "UPDATE decks SET current_path = NULL WHERE deck_id = ?",
  );
  const upsert = db.prepare(
    "INSERT INTO decks (deck_id, current_path) VALUES (?, ?) " +
      "ON CONFLICT(deck_id) DO UPDATE SET current_path = excluded.current_path",
  );
  const insertVersion = db.prepare(
    "INSERT INTO deck_versions (deck_id, seq, kind, status, commit_sha, blob_sha, path_at_commit, " +
      "author_name, author_date, author_ts, committer_date, subject) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const d of w.decks) nullPath.run(d.deckId);
    for (const d of w.decks) upsert.run(d.deckId, d.currentPath);
    for (const v of w.versions) {
      insertVersion.run(
        v.deckId,
        v.seq,
        v.kind,
        v.status,
        v.commitSha,
        v.blobSha,
        v.pathAtCommit,
        v.authorName,
        v.authorDate,
        v.authorTs,
        v.committerDate,
        v.subject,
      );
    }
    setState(db, "last_commit", w.lastCommit);
    setState(db, "last_seq", String(w.lastSeq));
  })();
}

export interface VersionRow {
  deckId: number;
  seq: number;
  kind: HistoryKind;
  status: HistoryStatus;
  commitSha: string;
  blobSha: string | null;
  pathAtCommit: string;
  authorName: string;
  authorDate: string;
  authorTs: number;
  committerDate: string;
  subject: string;
}

interface RawRow {
  deck_id: number;
  seq: number;
  kind: HistoryKind;
  status: HistoryStatus;
  commit_sha: string;
  blob_sha: string | null;
  path_at_commit: string;
  author_name: string;
  author_date: string;
  author_ts: number;
  committer_date: string;
  subject: string;
}

const toRow = (r: RawRow): VersionRow => ({
  deckId: r.deck_id,
  seq: r.seq,
  kind: r.kind,
  status: r.status,
  commitSha: r.commit_sha,
  blobSha: r.blob_sha,
  pathAtCommit: r.path_at_commit,
  authorName: r.author_name,
  authorDate: r.author_date,
  authorTs: r.author_ts,
  committerDate: r.committer_date,
  subject: r.subject,
});

/** All rows of the live deck at `currentPath`, oldest first. */
export function rowsForPath(db: Db, currentPath: string): VersionRow[] {
  return (
    db
      .prepare(
        "SELECT v.* FROM deck_versions v JOIN decks d ON d.deck_id = v.deck_id " +
          "WHERE d.current_path = ? ORDER BY v.seq ASC, v.kind ASC",
      )
      .all(currentPath) as RawRow[]
  ).map(toRow);
}

/** The newest `author_ts` (and its `author_date`) of every live deck. */
export function lastUpdatedAll(
  db: Db,
): Map<string, { authorTs: number; authorDate: string }> {
  const rows = db
    .prepare(
      "SELECT d.current_path AS p, v.author_ts AS ts, v.author_date AS dt FROM decks d " +
        "JOIN deck_versions v ON v.deck_id = d.deck_id WHERE d.current_path IS NOT NULL " +
        "ORDER BY v.author_ts ASC, v.seq ASC",
    )
    .all() as { p: string; ts: number; dt: string }[];
  const out = new Map<string, { authorTs: number; authorDate: string }>();
  for (const r of rows) out.set(r.p, { authorTs: r.ts, authorDate: r.dt });
  return out;
}
