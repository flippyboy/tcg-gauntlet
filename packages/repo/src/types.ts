import type { Violation } from "@tcg-gauntlet/engine";

// ---------------------------------------------------------------- repo scan

export interface DeckFile {
  /** Repo-relative path, `<gauntlet>/<name>.txt`. This is the deck's identity. */
  path: string;
  /** The file name without `.txt`. */
  name: string;
  text: string;
  /** The text of `<name>.md` next to the deck, when it exists. */
  primer?: string;
}

export interface GauntletContents {
  /** Top-level folder name. */
  folder: string;
  yamlText: string;
  /** The text of `gauntlet.md`, when it exists. */
  mdText?: string;
  decks: DeckFile[];
}

export interface FormatFile {
  /** Repo-relative path, `formats/<file>.yaml`. */
  path: string;
  text: string;
}

export interface RepoContents {
  gauntlets: GauntletContents[];
  formats: FormatFile[];
  /** Scan problems: limit and symlink errors (E-LIMIT-EXCEEDED) and W-PRIMER-ORPHAN. */
  errors: Violation[];
}

// ---------------------------------------------------------------- git diffs

export interface Change {
  status: "A" | "M" | "D" | "R";
  /** The new path for `R`. */
  path: string;
  /** The old path, for `R` only. */
  oldPath?: string;
}

// ------------------------------------------------------------------ history

/** One `--raw` entry of the history pass. `status` is the first letter only. */
export interface HistoryEntry {
  status: string;
  oldSha: string;
  newSha: string;
  path: string;
  /** The second path of an `R` or `C` entry. */
  path2?: string;
}

/** One first-parent commit of the history pass. */
export interface HistoryRecord {
  sha: string;
  authorName: string;
  /** `%aI`, with the author's own offset. */
  authorDate: string;
  /** `%at`, seconds since the epoch. */
  authorTs: number;
  committerDate: string;
  subject: string;
  entries: HistoryEntry[];
}

export type HistoryKind = "txt" | "md";
export type HistoryStatus = "A" | "M" | "D" | "R";

/** A row of `deck_versions`. */
export interface DeckVersionRow {
  deckId: number;
  seq: number;
  kind: HistoryKind;
  status: HistoryStatus;
  commitSha: string;
  /** Null for `D`. */
  blobSha: string | null;
  pathAtCommit: string;
  authorName: string;
  authorDate: string;
  authorTs: number;
  committerDate: string;
  subject: string;
}

/** A row of `decks`. `currentPath` is `<gauntlet>/<deck>`, or null once deleted. */
export interface DeckRow {
  deckId: number;
  currentPath: string | null;
}

/** What the history pass needs to know from the database before it starts. */
export interface HistoryState {
  /** `sync_state.last_seq`, 0 for a full rebuild. */
  lastSeq: number;
  /** The largest `deck_id` ever issued (dead decks included), 0 for none. */
  maxDeckId: number;
  /** Decks whose `current_path` is not NULL. */
  liveDecks: DeckRow[];
}

export interface HistoryResult {
  /**
   * The final row of every deck that was created or changed by this pass. A
   * persister that applies them one by one must first set `current_path` to NULL
   * for all of them, then write the new values, because a deck may take over a
   * path that another deck in the same batch gives up.
   */
  decks: (DeckRow & { created: boolean })[];
  versions: DeckVersionRow[];
  /** The new `sync_state.last_seq`. */
  lastSeq: number;
  /** The new largest `deck_id`. */
  maxDeckId: number;
}
