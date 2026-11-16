// Version history: persists the output of the repo package's `applyHistory` in
// `history.sqlite`, chooses between a full rebuild and an incremental update, and
// serves the version list and the content of old versions.
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LRUCache } from "lru-cache";
import { parseDeck } from "@tcg-gauntlet/engine";
import type { ParsedDeck } from "@tcg-gauntlet/engine";
import { moveAtomic } from "@tcg-gauntlet/carddata";
import { applyHistory, emptyHistoryState } from "@tcg-gauntlet/repo";
import type { CatFile, Git, HistoryStatus } from "@tcg-gauntlet/repo";
import {
  type Db,
  type VersionRow,
  getState,
  lastUpdatedAll,
  openHistoryDb,
  readHistoryState,
  removeDbFiles,
  rowsForPath,
  writeHistory,
} from "./history-db.js";
import { logger } from "./logger.js";

/** One entry of a deck's version list: the deck as of one first-parent commit. */
export interface DeckVersion {
  seq: number;
  commitSha: string;
  authorName: string;
  authorDate: string;
  authorTs: number;
  subject: string;
  /** The status of the `.txt` row at this seq, or of the `.md` row for a primer-only change. */
  status: HistoryStatus;
  /** Which files changed in this commit. */
  changed: ("txt" | "md")[];
  /** The deck's `.txt` blob as of this version. Null once deleted. */
  txtBlob: string | null;
  /** The primer's blob as of this version. */
  mdBlob: string | null;
}

export interface VersionContent {
  text: string;
  /** Null when the text no longer parses under the current schema. */
  parsed: ParsedDeck | null;
}

export type UpdateMode = "full" | "incremental" | "none";

/** The history database and the readers that go with it. */
export class History {
  private db: Db | null = null;
  private cat: CatFile | null = null;
  private readonly cache = new LRUCache<string, VersionContent>({ max: 500 });

  constructor(
    private readonly git: Git,
    readonly dbPath: string,
    private readonly repoDir: string,
  ) {}

  /** Opens the file. A missing file is created. A damaged one is deleted and made again. */
  open(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    try {
      this.db = openHistoryDb(this.dbPath);
    } catch (e) {
      logger.warn("history.sqlite is damaged, starting over", { err: e });
      removeDbFiles(this.dbPath);
      this.db = openHistoryDb(this.dbPath);
    }
  }

  private handle(): Db {
    if (this.db === null) throw new Error("history.sqlite is not open");
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.stopCatFile();
  }

  /** Call after the clone was replaced: the old `cat-file` process points at a deleted repo. */
  stopCatFile(): void {
    const c = this.cat;
    this.cat = null;
    c?.close().catch(() => undefined);
  }

  lastCommit(): string | null {
    return getState(this.handle(), "last_commit");
  }

  /**
   * Brings the database to `newHead` (a commit SHA). An incremental update runs when
   * `last_commit` is an ancestor of `newHead`. Otherwise (first start, force-push,
   * a `last_commit` that is no longer in the clone) the file is rebuilt.
   */
  async update(newHead: string): Promise<UpdateMode> {
    const last = this.lastCommit();
    if (
      last !== null &&
      (await this.git.isAncestor(this.repoDir, last, newHead))
    ) {
      if (last === newHead) return "none";
      const records = await this.git.logHistory(
        this.repoDir,
        `${last}..${newHead}`,
      );
      const db = this.handle();
      const result = applyHistory(records, readHistoryState(db));
      writeHistory(db, { ...result, lastCommit: newHead });
      return "incremental";
    }
    await this.rebuild(newHead);
    return "full";
  }

  /** Full rebuild into `history.sqlite.tmp`, then an atomic rename and a reopen. */
  private async rebuild(newHead: string): Promise<void> {
    const records = await this.git.logHistory(this.repoDir, newHead);
    const result = applyHistory(records, emptyHistoryState());
    const tmp = `${this.dbPath}.tmp`;
    removeDbFiles(tmp);
    const fresh = openHistoryDb(tmp);
    try {
      writeHistory(fresh, { ...result, lastCommit: newHead });
    } finally {
      fresh.close();
    }
    // The old handle keeps serving until the rename.
    await moveAtomic(tmp, this.dbPath);
    const old = this.db;
    this.db = openHistoryDb(this.dbPath);
    old?.close();
    this.cache.clear();
  }

  /**
   * The deck's versions, newest first, at most `limit`. A version is one `seq`: its
   * `.txt` and `.md` rows share it. The blobs are those in effect at that version.
   */
  versions(currentPath: string, limit: number): DeckVersion[] {
    const rows = rowsForPath(this.handle(), currentPath);
    const out: DeckVersion[] = [];
    let txt: string | null = null;
    let md: string | null = null;
    let i = 0;
    while (i < rows.length) {
      const seq = (rows[i] as VersionRow).seq;
      const group: VersionRow[] = [];
      while (i < rows.length && (rows[i] as VersionRow).seq === seq)
        group.push(rows[i++] as VersionRow);
      for (const r of group) {
        if (r.kind === "txt") txt = r.blobSha;
        else md = r.blobSha;
      }
      const head = group.find((r) => r.kind === "txt") ?? group[0];
      if (head === undefined) continue;
      out.push({
        seq,
        commitSha: head.commitSha,
        authorName: head.authorName,
        authorDate: head.authorDate,
        authorTs: head.authorTs,
        subject: head.subject,
        status: head.status,
        changed: group.map((r) => r.kind),
        txtBlob: txt,
        mdBlob: md,
      });
    }
    return out.reverse().slice(0, Math.max(0, limit));
  }

  /** The newest `author_ts` of every live deck, by `current_path`. */
  lastUpdatedMap(): Map<string, { authorTs: number; authorDate: string }> {
    return lastUpdatedAll(this.handle());
  }

  /** The newest `author_ts` across the deck's `txt` and `md` rows. */
  lastUpdated(
    currentPath: string,
  ): { authorTs: number; authorDate: string } | null {
    return this.lastUpdatedMap().get(currentPath) ?? null;
  }

  private catFile(): CatFile {
    this.cat ??= this.git.catFile(this.repoDir);
    return this.cat;
  }

  /** The raw text of a blob, read through the long-lived `git cat-file --batch`. */
  async rawText(blobSha: string): Promise<string> {
    try {
      return await this.catFile().read(blobSha);
    } catch (e) {
      // A dead process is replaced once.
      this.stopCatFile();
      if (
        e instanceof Error &&
        /not in the repository|Not an object/.test(e.message)
      )
        throw e;
      return this.catFile().read(blobSha);
    }
  }

  /** The parsed version, or its raw text when it does not parse. Cached (500 entries). */
  async content(blobSha: string): Promise<VersionContent> {
    const hit = this.cache.get(blobSha);
    if (hit !== undefined) return hit;
    const text = await this.rawText(blobSha);
    const parsed = parseDeck(text, "deck.txt");
    const value: VersionContent = {
      text,
      parsed: parsed.parseErrors.length > 0 ? null : parsed,
    };
    this.cache.set(blobSha, value);
    return value;
  }

  /** True when the file exists on disk (for tests and the readiness check). */
  fileExists(): boolean {
    return existsSync(this.dbPath);
  }
}

/** `updateHistory(history, newHead)`: the sync loop's entry point. */
export const updateHistory = (
  h: History,
  newHead: string,
): Promise<UpdateMode> => h.update(newHead);
