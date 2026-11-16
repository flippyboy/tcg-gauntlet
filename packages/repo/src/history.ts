// The history pass (Technical Plan, "History in history.sqlite"): the parser of
// `git log` output and the pure status rules. Persisting the result is the app's job.
import type {
  DeckRow,
  DeckVersionRow,
  HistoryEntry,
  HistoryKind,
  HistoryRecord,
  HistoryResult,
  HistoryState,
  HistoryStatus,
} from "./types.js";

/**
 * Parses the output of the history pass command. Each record is
 * `\x1e<sha>\x1f<name>\x1f<aI>\x1f<at>\x1f<cI>\x1f<subject>\0\n` followed by
 * `:<modes> <old sha> <new sha> <status>\0<path>\0[<path2>\0]` entries, with no
 * separator between entries or records.
 *
 * The output is read token by token (NUL separated). A token that starts with
 * `\x1e` is a header. Entry paths are consumed by position, so a path or a
 * subject that contains `\x1e` or `\x1f` cannot be mistaken for a boundary.
 */
export function parseHistoryLog(out: string): HistoryRecord[] {
  const recs: HistoryRecord[] = [];
  const toks = out.split("\0");
  let cur: HistoryRecord | null = null;
  let i = 0;
  while (i < toks.length) {
    const tok = toks[i] ?? "";
    if (tok.startsWith("\x1e")) {
      const f = tok.slice(1).split("\x1f");
      const [sha, authorName, authorDate, at, committerDate] = f;
      if (
        sha === undefined ||
        authorName === undefined ||
        authorDate === undefined ||
        at === undefined ||
        committerDate === undefined
      ) {
        throw new Error(
          `History parse error in header: ${JSON.stringify(tok)}`,
        );
      }
      cur = {
        sha,
        authorName,
        authorDate,
        authorTs: Number(at),
        committerDate,
        subject: f.slice(5).join("\x1f"),
        entries: [],
      };
      recs.push(cur);
      i++;
      continue;
    }
    // A meta token may carry the "\n" that follows the header.
    const meta = tok.startsWith("\n") ? tok.slice(1) : tok;
    if (meta === "") {
      i++;
      continue;
    }
    if (cur === null || !meta.startsWith(":")) {
      throw new Error(
        `History parse error near ${cur?.sha ?? "start"}: ${JSON.stringify(tok)}`,
      );
    }
    const fields = meta.slice(1).split(" "); // old mode, new mode, old sha, new sha, status
    const status = fields[4] ?? "";
    const entry: HistoryEntry = {
      status: status.slice(0, 1),
      oldSha: fields[2] ?? "",
      newSha: fields[3] ?? "",
      path: toks[i + 1] ?? "",
    };
    i += 2;
    if (entry.status === "R" || entry.status === "C") {
      entry.path2 = toks[i] ?? "";
      i++;
    }
    cur.entries.push(entry);
  }
  return recs;
}

// ----------------------------------------------------------- the path filter

interface Classified {
  stem: string;
  kind: HistoryKind;
}

/** Only `<gauntlet>/<deck>.txt` and `.md`, directly in a top-level folder, are kept. */
export function classifyPath(p: string | undefined): Classified | null {
  if (p === undefined) return null;
  const m = /^([^/]+)\/([^/]+)\.(txt|md)$/.exec(p);
  if (m === null) return null;
  return { stem: `${m[1] ?? ""}/${m[2] ?? ""}`, kind: m[3] as HistoryKind };
}

// --------------------------------------------------------------- the rules

interface Act {
  op: HistoryStatus;
  kind: HistoryKind;
  path: string;
  blob: string | null;
  fromStem?: string;
  stem: string;
}

const ZERO = /^0+$/;

function actionsOf(rec: HistoryRecord): Act[] {
  const acts: Act[] = [];
  for (const e of rec.entries) {
    const letter = e.status;
    const blob = ZERO.test(e.newSha) ? null : e.newSha;
    if (letter === "R") {
      const a = classifyPath(e.path);
      const b = classifyPath(e.path2);
      if (a !== null && b !== null && a.kind === b.kind) {
        acts.push({
          op: "R",
          kind: a.kind,
          path: e.path2 ?? "",
          blob,
          fromStem: a.stem,
          stem: b.stem,
        });
      } else {
        // Boundary rule: the other side is outside the filter, or the extension changed.
        if (a !== null)
          acts.push({
            op: "D",
            kind: a.kind,
            path: e.path,
            blob: null,
            stem: a.stem,
          });
        if (b !== null)
          acts.push({
            op: "A",
            kind: b.kind,
            path: e.path2 ?? "",
            blob,
            stem: b.stem,
          });
      }
    } else if (letter === "C") {
      const b = classifyPath(e.path2);
      if (b !== null)
        acts.push({
          op: "A",
          kind: b.kind,
          path: e.path2 ?? "",
          blob,
          stem: b.stem,
        });
    } else {
      const a = classifyPath(e.path);
      if (a !== null) {
        const op: HistoryStatus =
          letter === "D" ? "D" : letter === "A" ? "A" : "M";
        acts.push({
          op,
          kind: a.kind,
          path: e.path,
          blob: op === "D" ? null : blob,
          stem: a.stem,
        });
      }
    }
  }
  // .txt before .md; within a kind, detach (D, R) before attach (A, M).
  const rank = (x: Act): number =>
    (x.kind === "txt" ? 0 : 10) + (x.op === "D" || x.op === "R" ? 0 : 1);
  return acts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a);
}

/**
 * Applies the status rules to the parsed commits, in order. The result is the
 * same whether `records` is the whole history with an empty `prior`, or the
 * commits since `last_commit` with the state the database holds.
 */
export function applyHistory(
  records: readonly HistoryRecord[],
  prior: HistoryState,
): HistoryResult {
  const live = new Map<string, number>();
  for (const d of prior.liveDecks)
    if (d.currentPath !== null) live.set(d.currentPath, d.deckId);
  const touched = new Map<number, DeckRow & { created: boolean }>();
  const versions: DeckVersionRow[] = [];
  let maxDeckId = prior.maxDeckId;
  let seq = prior.lastSeq;

  const touch = (
    deckId: number,
    currentPath: string | null,
    created = false,
  ): void => {
    const was = touched.get(deckId);
    touched.set(deckId, {
      deckId,
      currentPath,
      created: created || was?.created === true,
    });
  };
  const newDeck = (stem: string): number => {
    maxDeckId++;
    live.set(stem, maxDeckId);
    touch(maxDeckId, stem, true);
    return maxDeckId;
  };

  for (const rec of records) {
    const next = seq + 1;
    let used = false;
    const put = (deckId: number, a: Act, status: HistoryStatus): void => {
      versions.push({
        deckId,
        seq: next,
        kind: a.kind,
        status,
        commitSha: rec.sha,
        blobSha: status === "D" ? null : a.blob,
        pathAtCommit: a.path,
        authorName: rec.authorName,
        authorDate: rec.authorDate,
        authorTs: rec.authorTs,
        committerDate: rec.committerDate,
        subject: rec.subject,
      });
      used = true;
    };
    for (const a of actionsOf(rec)) {
      if (a.kind === "txt") {
        if (a.op === "R") {
          const id = live.get(a.fromStem ?? "");
          if (id === undefined) {
            put(newDeck(a.stem), a, "A");
          } else {
            if (a.fromStem !== a.stem) {
              live.delete(a.fromStem ?? "");
              live.set(a.stem, id);
              touch(id, a.stem);
            }
            put(id, a, "R");
          }
        } else if (a.op === "D") {
          const id = live.get(a.stem);
          if (id === undefined) continue;
          put(id, a, "D");
          live.delete(a.stem);
          touch(id, null);
        } else {
          const id = live.get(a.stem);
          if (id === undefined) put(newDeck(a.stem), a, "A");
          else put(id, a, a.op === "A" ? "M" : a.op); // A on a live path cannot happen in git
        }
      } else if (a.op === "R") {
        const to = live.get(a.stem);
        const from = live.get(a.fromStem ?? "");
        if (to !== undefined && (from === undefined || from === to)) {
          put(to, a, "R"); // the primer follows its deck
        } else {
          // The primer moved away from a deck that stayed: D at the old stem, A at the new one.
          if (from !== undefined)
            put(
              from,
              { ...a, path: `${a.fromStem ?? ""}.md`, blob: null },
              "D",
            );
          if (to !== undefined) put(to, a, "A");
        }
      } else {
        const id = live.get(a.stem);
        if (id !== undefined) put(id, a, a.op);
      }
    }
    if (used) seq = next;
  }
  return {
    decks: [...touched.values()].sort((a, b) => a.deckId - b.deckId),
    versions,
    lastSeq: seq,
    maxDeckId,
  };
}

/** The state of an empty database, for a full rebuild. */
export function emptyHistoryState(): HistoryState {
  return { lastSeq: 0, maxDeckId: 0, liveDecks: [] };
}
