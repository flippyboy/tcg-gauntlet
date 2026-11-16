import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import { Git, applyHistory, emptyHistoryState } from "../src/index.js";
import type { DeckRow, DeckVersionRow, HistoryState } from "../src/index.js";

const dirs: string[] = [];

/** A fresh temp dir, removed after the test file. */
export function tmp(prefix = "repo-test-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let clock = 1_800_000_000;

export interface Who {
  name: string;
  tz?: string;
}

/**
 * Runs git directly (not through the wrapper) for building fixtures. It ignores
 * every global config, and each commit gets a later date than the one before.
 */
export function g(
  cwd: string,
  args: string[],
  who: Who = { name: "Syn Thetic" },
): string {
  clock += 60;
  const r = spawnSync("git", args, {
    cwd,
    maxBuffer: 1 << 28,
    env: {
      PATH: process.env["PATH"],
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: "a@example.com",
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: "a@example.com",
      GIT_AUTHOR_DATE: `${clock} ${who.tz ?? "+0200"}`,
      GIT_COMMITTER_DATE: `${clock} +0000`,
    },
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** `git init -b main` with a local user name and email. */
export function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  g(dir, ["init", "-q", "-b", "main"]);
  g(dir, ["config", "user.name", "Syn Thetic"]);
  g(dir, ["config", "user.email", "a@example.com"]);
}

export function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

export function commitAll(dir: string, msg: string, who?: Who): string {
  g(dir, ["add", "-A"], who);
  g(dir, ["commit", "-q", "-m", msg], who);
  return g(dir, ["rev-parse", "HEAD"]).trim();
}

export function newGit(testMode = true): Git {
  return new Git({ dataDir: tmp("data-"), testMode });
}

export function fileUrl(dir: string): string {
  return `file://${dir}`;
}

export function readText(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

// -------------------------------------------------- an in-memory history store

/** What Phase 7 keeps in `history.sqlite`, reduced to the history tables. */
export class Store {
  decks = new Map<number, string | null>();
  versions: DeckVersionRow[] = [];
  lastSeq = 0;
  maxDeckId = 0;
  lastCommit: string | null = null;

  state(): HistoryState {
    const liveDecks: DeckRow[] = [];
    for (const [deckId, currentPath] of this.decks) {
      if (currentPath !== null) liveDecks.push({ deckId, currentPath });
    }
    return { lastSeq: this.lastSeq, maxDeckId: this.maxDeckId, liveDecks };
  }

  persist(result: ReturnType<typeof applyHistory>, head: string): void {
    // Two steps, as the doc comment of HistoryResult says (unique current_path).
    for (const d of result.decks) this.decks.set(d.deckId, null);
    for (const d of result.decks) this.decks.set(d.deckId, d.currentPath);
    const live = [...this.decks.values()].filter(
      (p): p is string => p !== null,
    );
    if (new Set(live).size !== live.length)
      throw new Error("two decks share a current_path");
    this.versions.push(...result.versions);
    this.lastSeq = result.lastSeq;
    this.maxDeckId = result.maxDeckId;
    this.lastCommit = head;
  }

  dump(): string {
    return JSON.stringify({
      decks: [...this.decks].sort((a, b) => a[0] - b[0]),
      versions: [...this.versions].sort(
        (a, b) =>
          a.deckId - b.deckId || a.seq - b.seq || a.kind.localeCompare(b.kind),
      ),
      lastSeq: this.lastSeq,
      lastCommit: this.lastCommit,
    });
  }
}

export async function fullHistory(
  git: Git,
  dir: string,
  head = "HEAD",
): Promise<Store> {
  const sha = await git.revParse(dir, head);
  const store = new Store();
  store.persist(
    applyHistory(await git.logHistory(dir, sha), emptyHistoryState()),
    sha,
  );
  return store;
}

/** Null when an incremental update is impossible and a full rebuild is needed. */
export async function incrementalHistory(
  git: Git,
  dir: string,
  store: Store,
  head = "HEAD",
): Promise<boolean> {
  const sha = await git.revParse(dir, head);
  const last = store.lastCommit;
  if (last === null || !(await git.isAncestor(dir, last, sha))) return false;
  if (last === sha) return true;
  store.persist(
    applyHistory(await git.logHistory(dir, `${last}..${sha}`), store.state()),
    sha,
  );
  return true;
}

// ------------------------------------------------------- a generated history

function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOLDERS = ["modern 2015", "pauper cube", "Épique", "budget"];
const NAMES = [
  "Burn",
  "Death & Taxes",
  "日本語 deck",
  "Niño ★ Combo",
  "Élan Vital",
  "Merfolk",
  "Tron",
  "Slivers",
  "Storm",
  "Zoo",
  "Affinity",
  "Jund",
  "Elves",
  "Control",
  "Humans",
  "Dredge",
];

export interface GeneratedRepo {
  commits: number;
  merges: number;
}

/**
 * Builds a deterministic history of about `steps` steps: new decks, edits,
 * renames (alone, with an edit, with the primer), deletes, re-adds, primers,
 * non-deck files and merged feature branches. Decks have unique content, so git
 * pairs renames correctly.
 */
export function generateRepo(
  dir: string,
  steps: number,
  seed = 7,
): GeneratedRepo {
  initRepo(dir);
  const rnd = prng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const live = new Map<string, number>(); // txt path -> unique id
  const primers = new Set<string>();
  const dead: string[] = [];
  const orphans = new Set<string>(); // deleted decks whose primer stayed behind
  let uid = 0;
  let merges = 0;
  let commits = 0;
  const body = (id: number, rev: number): string =>
    Array.from(
      { length: 24 },
      (_, i) => `${1 + ((i + rev) % 4)} Card ${id}-${i}`,
    ).join("\n") + "\n";
  const freePath = (): string => {
    for (let k = 0; k < 50; k++) {
      const p = `${pick(FOLDERS)}/${pick(NAMES)}${k > 3 ? ` ${k}` : ""}.txt`;
      if (!live.has(p) && !orphans.has(p)) return p;
    }
    return `${pick(FOLDERS)}/Fresh ${uid++}.txt`;
  };
  const commit = (msg: string, who?: Who): void => {
    commitAll(dir, msg, who);
    commits++;
  };
  const addDeck = (p: string, msg: string): void => {
    const id = uid++;
    live.set(p, id);
    write(dir, p, body(id, 0));
    if (orphans.delete(p) || rnd() < 0.5) {
      write(dir, p.replace(/\.txt$/, ".md"), `# Primer ${id}\n`);
      primers.add(p);
    }
    commit(msg);
  };
  const rename = (from: string, to: string, edit: boolean): void => {
    g(dir, ["mv", from, to]);
    const id = live.get(from) as number;
    live.delete(from);
    live.set(to, id);
    if (primers.delete(from)) {
      // The primer moves in the same commit, or in the next one.
      g(dir, [
        "mv",
        from.replace(/\.txt$/, ".md"),
        to.replace(/\.txt$/, ".md"),
      ]);
      primers.add(to);
    }
    if (edit)
      write(dir, to, body(id, 0).replace(/Card \d+-3\n/, `Card ${id}-X\n`));
  };

  for (let k = 0; k < 6; k++) addDeck(freePath(), `add ${k}`);
  for (let step = 0; step < steps; step++) {
    const r = rnd();
    const paths = [...live.keys()];
    if (r < 0.22 || paths.length < 3) {
      addDeck(freePath(), `add deck ${step}`);
    } else if (r < 0.5) {
      const p = pick(paths);
      write(dir, p, readText(dir, p) + `1 Extra ${step}\n`);
      commit(`edit ${step}`);
    } else if (r < 0.58) {
      const p = pick(paths);
      write(dir, p.replace(/\.txt$/, ".md"), `# Primer edit ${step}\n`);
      primers.add(p);
      commit(`primer ${step}`);
    } else if (r < 0.72) {
      const from = pick(paths);
      rename(from, freePath(), rnd() < 0.4);
      commit(`rename ${step}`);
    } else if (r < 0.8) {
      const p = pick(paths);
      g(dir, ["rm", "-q", p]);
      live.delete(p);
      if (primers.delete(p)) {
        if (rnd() < 0.5) g(dir, ["rm", "-q", p.replace(/\.txt$/, ".md")]);
        else orphans.add(p);
      }
      dead.push(p);
      commit(`delete ${step}`);
    } else if (r < 0.86 && dead.length > 0) {
      const p = dead.splice(Math.floor(rnd() * dead.length), 1)[0] as string;
      if (!live.has(p)) addDeck(p, `re-add ${step}`);
    } else if (r < 0.9) {
      write(dir, "README.md", `x${step}\n`);
      write(dir, `${pick(FOLDERS)}/sub/Nested ${step}.txt`, "nested\n");
      write(dir, "formats/x.yaml", `a: ${step}\n`);
      commit(`non deck ${step}`);
    } else {
      const branch = `feat/${step}`;
      const from = pick(paths);
      g(dir, ["checkout", "-q", "-b", branch]);
      const to = freePath();
      rename(from, to, false);
      commit("feature rename", { name: "Dee Dvorak", tz: "-0500" });
      write(dir, to, readText(dir, to) + `1 Feature ${step}\n`);
      commit("feature edit", { name: "Dee Dvorak", tz: "-0500" });
      g(dir, ["checkout", "-q", "main"]);
      // The rename happened on the branch only, so main has the old name until the merge.
      write(dir, "README.md", `y${step}\n`);
      commit("unrelated main commit");
      g(dir, ["merge", "-q", "--no-ff", "-m", `Merge ${branch}`, branch], {
        name: "Merge Bot",
      });
      commits++;
      merges++;
    }
  }
  return { commits, merges };
}
