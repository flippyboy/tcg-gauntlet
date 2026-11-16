import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyHistory,
  classifyPath,
  emptyHistoryState,
  parseHistoryLog,
} from "../src/index.js";
import type {
  HistoryEntry,
  HistoryRecord,
  HistoryState,
} from "../src/index.js";
import {
  Store,
  commitAll,
  fileUrl,
  fullHistory,
  g,
  generateRepo,
  incrementalHistory,
  newGit,
  tmp,
  write,
} from "./helpers.js";

const S1 = "1".repeat(40);
const S2 = "2".repeat(40);
const ZERO = "0".repeat(40);

function raw(
  status: string,
  path: string,
  path2?: string,
  newSha = S2,
): string {
  return `:100644 100644 ${S1} ${newSha} ${status}\0${path}\0${path2 === undefined ? "" : `${path2}\0`}`;
}

function logText(sha: string, subject: string, entries: string): string {
  return `\x1e${sha}\x1fAuthor\x1f2024-01-01T10:00:00+02:00\x1f1704096000\x1f2024-01-01T08:00:00+00:00\x1f${subject}\0\n${entries}`;
}

describe("parseHistoryLog", () => {
  it("parses entries, renames, and a record without entries", () => {
    const out =
      logText(
        S1,
        "first",
        raw("A", "g/a.txt") + raw("R100", "g/o.md", "g/n.md"),
      ) + logText(S2, "nothing", "");
    const recs = parseHistoryLog(out);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      sha: S1,
      authorName: "Author",
      authorDate: "2024-01-01T10:00:00+02:00",
      authorTs: 1704096000,
      committerDate: "2024-01-01T08:00:00+00:00",
      subject: "first",
    });
    expect(recs[0]?.entries).toEqual([
      { status: "A", oldSha: S1, newSha: S2, path: "g/a.txt" },
      { status: "R", oldSha: S1, newSha: S2, path: "g/o.md", path2: "g/n.md" },
    ]);
    expect(recs[1]?.entries).toEqual([]);
    expect(parseHistoryLog("")).toEqual([]);
  });

  it("does not trip over control characters in subjects or odd path names", () => {
    const odd = "g/line\nbreak\x1e.txt";
    const out =
      logText(S1, "a\x1fb\x1ec", raw("A", odd)) +
      logText(S2, "next", raw("D", "g/x.txt", undefined, ZERO));
    const recs = parseHistoryLog(out);
    expect(recs.map((r) => r.subject)).toEqual(["a\x1fb\x1ec", "next"]);
    expect(recs[0]?.entries[0]?.path).toBe(odd);
    expect(recs[1]?.entries[0]?.status).toBe("D");
  });

  it("throws on output it cannot read", () => {
    expect(() => parseHistoryLog("garbage\0")).toThrow(/parse error/);
    expect(() => parseHistoryLog(`\x1eonly-a-sha\0`)).toThrow(/header/);
    expect(() => parseHistoryLog(`${raw("A", "x")}`)).toThrow(/parse error/);
  });
});

function rec(sha: string, ...entries: Partial<HistoryEntry>[]): HistoryRecord {
  return {
    sha,
    authorName: "A",
    authorDate: "2024-01-01T00:00:00+00:00",
    authorTs: 1704067200,
    committerDate: "2024-01-01T00:00:00+00:00",
    subject: `s ${sha}`,
    entries: entries.map((e) => ({
      status: "M",
      oldSha: S1,
      newSha: S2,
      path: "",
      ...e,
    })),
  };
}

const brief = (r: ReturnType<typeof applyHistory>): string[] =>
  r.versions.map(
    (v) => `${v.seq}:${v.deckId}:${v.kind}:${v.status}:${v.pathAtCommit}`,
  );

describe("applyHistory (status rules)", () => {
  it("classifies paths", () => {
    expect(classifyPath("g/a b.txt")).toEqual({ stem: "g/a b", kind: "txt" });
    expect(classifyPath("g/a.md")).toEqual({ stem: "g/a", kind: "md" });
    for (const p of [
      "a.txt",
      "g/s/a.txt",
      "g/a.bak",
      "g/a.txt.old",
      undefined,
    ]) {
      expect(classifyPath(p)).toBeNull();
    }
  });

  it("creates, edits, renames and deletes a deck; a re-add is a new deck", () => {
    const r = applyHistory(
      [
        rec("c1", { status: "A", path: "g/a.txt" }),
        rec(
          "c2",
          { status: "M", path: "g/a.txt" },
          { status: "A", path: "g/a.md" },
        ),
        rec("c3", { status: "R", path: "g/a.txt", path2: "g/b.txt" }),
        rec("c4", { status: "D", path: "g/b.txt", newSha: ZERO }),
        rec("c5", { status: "A", path: "g/b.txt" }),
      ],
      emptyHistoryState(),
    );
    expect(brief(r)).toEqual([
      "1:1:txt:A:g/a.txt",
      "2:1:txt:M:g/a.txt",
      "2:1:md:A:g/a.md",
      "3:1:txt:R:g/b.txt",
      "4:1:txt:D:g/b.txt",
      "5:2:txt:A:g/b.txt",
    ]);
    expect(r.versions[4]?.blobSha).toBeNull();
    expect(r.decks).toEqual([
      { deckId: 1, currentPath: null, created: true },
      { deckId: 2, currentPath: "g/b", created: true },
    ]);
    expect(r.lastSeq).toBe(5);
    expect(r.maxDeckId).toBe(2);
  });

  it("orders D and R before A and M inside one commit (a->b plus a new a)", () => {
    const r = applyHistory(
      [
        rec("c1", { status: "A", path: "g/a.txt" }),
        rec(
          "c2",
          { status: "A", path: "g/a.txt" },
          { status: "R", path: "g/a.txt", path2: "g/b.txt" },
        ),
      ],
      emptyHistoryState(),
    );
    expect(brief(r)).toEqual([
      "1:1:txt:A:g/a.txt",
      "2:1:txt:R:g/b.txt",
      "2:2:txt:A:g/a.txt",
    ]);
  });

  it("treats an M or R with no live row as an A", () => {
    const r = applyHistory(
      [
        rec("c1", { status: "M", path: "g/a.txt" }),
        rec("c2", { status: "R", path: "g/x.txt", path2: "g/y.txt" }),
        rec("c3", { status: "A", path: "g/a.txt" }),
        rec("c4", { status: "D", path: "g/zzz.txt", newSha: ZERO }),
      ],
      emptyHistoryState(),
    );
    expect(brief(r)).toEqual([
      "1:1:txt:A:g/a.txt",
      "2:2:txt:A:g/y.txt",
      "3:1:txt:M:g/a.txt", // A on a live path is recorded as M
    ]);
    expect(r.lastSeq).toBe(3); // c4 had no kept entry
  });

  it("applies the boundary rule to renames", () => {
    const r = applyHistory(
      [
        rec(
          "c1",
          { status: "A", path: "g/a.txt" },
          { status: "A", path: "g/b.txt" },
          { status: "A", path: "g/c.txt" },
          { status: "A", path: "g/d.txt" },
        ),
        rec(
          "c2",
          { status: "R", path: "g/a.txt", path2: "g/sub/a.txt" }, // into a nested folder: D
          { status: "R", path: "g/b.txt", path2: "b.txt" }, // out to the root: D
          { status: "R", path: "g/c.txt", path2: "g/c.md" }, // across extensions: D and md A (no deck at g/c: dropped)
          { status: "R", path: "x/s/n.txt", path2: "g/e.txt" }, // from outside the filter: A
          { status: "R", path: "x/s/n.txt", path2: "x/s/m.txt" }, // outside both: dropped
          { status: "C", path: "g/d.txt", path2: "g/f.txt" }, // copy: A of the new path
        ),
      ],
      emptyHistoryState(),
    );
    expect(brief(r).slice(4).sort()).toEqual([
      "2:1:txt:D:g/a.txt",
      "2:2:txt:D:g/b.txt",
      "2:3:txt:D:g/c.txt",
      "2:5:txt:A:g/e.txt",
      "2:6:txt:A:g/f.txt",
    ]);
  });

  it("attaches primers to the live deck and skips orphans", () => {
    const r = applyHistory(
      [
        rec("c1", { status: "A", path: "g/a.md" }), // primer before its deck: skipped
        rec("c2", { status: "A", path: "g/a.txt" }),
        rec("c3", { status: "M", path: "g/a.md" }),
        rec(
          "c4",
          { status: "R", path: "g/a.txt", path2: "g/b.txt" },
          { status: "R", path: "g/a.md", path2: "g/b.md" },
        ),
        rec("c5", { status: "D", path: "g/b.txt", newSha: ZERO }),
        rec("c6", { status: "M", path: "g/b.md" }), // the deck is gone
      ],
      emptyHistoryState(),
    );
    expect(brief(r)).toEqual([
      "1:1:txt:A:g/a.txt",
      "2:1:md:M:g/a.md",
      "3:1:txt:R:g/b.txt",
      "3:1:md:R:g/b.md",
      "4:1:txt:D:g/b.txt",
    ]);
    expect(r.lastSeq).toBe(4);
  });

  it("splits a primer that moves away from a deck that stays", () => {
    const r = applyHistory(
      [
        rec(
          "c1",
          { status: "A", path: "g/a.txt" },
          { status: "A", path: "g/b.txt" },
        ),
        rec("c2", { status: "A", path: "g/a.md" }),
        rec("c3", { status: "R", path: "g/a.md", path2: "g/b.md" }),
        rec("c4", { status: "R", path: "g/b.md", path2: "g/zzz.md" }),
      ],
      emptyHistoryState(),
    );
    expect(brief(r).slice(2)).toEqual([
      "2:1:md:A:g/a.md",
      "3:1:md:D:g/a.md",
      "3:2:md:A:g/b.md",
      "4:2:md:D:g/b.md", // moved to a stem with no deck: only the D
    ]);
  });

  it("continues from the prior state", () => {
    const prior: HistoryState = {
      lastSeq: 40,
      maxDeckId: 9,
      liveDecks: [{ deckId: 5, currentPath: "g/a" }],
    };
    const r = applyHistory(
      [
        rec("c1", { status: "M", path: "g/a.txt" }),
        rec("c2", { status: "A", path: "g/n.txt" }),
      ],
      prior,
    );
    expect(brief(r)).toEqual(["41:5:txt:M:g/a.txt", "42:10:txt:A:g/n.txt"]);
    expect(r.decks).toEqual([
      { deckId: 10, currentPath: "g/n", created: true },
    ]);
    expect(r.lastSeq).toBe(42);
    expect(r.maxDeckId).toBe(10);
  });

  it("returns the final path of a deck that moved twice", () => {
    const r = applyHistory(
      [
        rec("c1", { status: "A", path: "g/a.txt" }),
        rec("c2", { status: "R", path: "g/a.txt", path2: "g/b.txt" }),
        rec("c3", { status: "R", path: "g/b.txt", path2: "g/c.txt" }),
      ],
      emptyHistoryState(),
    );
    expect(r.decks).toEqual([{ deckId: 1, currentPath: "g/c", created: true }]);
    const later = applyHistory(
      [rec("c4", { status: "R", path: "g/c.txt", path2: "g/d.txt" })],
      {
        lastSeq: 3,
        maxDeckId: 1,
        liveDecks: [{ deckId: 1, currentPath: "g/c" }],
      },
    );
    expect(later.decks).toEqual([
      { deckId: 1, currentPath: "g/d", created: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The spike's correctness checks (docs/spikes/git-history-cost.md), on a small
// generated repo.

const deckBody = (n: number): string =>
  Array.from(
    { length: 24 },
    (_, i) => `${1 + ((i + n) % 4)} Card ${i} [LEA]`,
  ).join("\n") + "\n";

function mv(dir: string, from: string, to: string): void {
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  g(dir, ["mv", from, to]);
}

describe("history pass against a generated repo", () => {
  const git = newGit();
  const originDir = join(tmp("origin-"), "o");
  const incDir = join(tmp("inc-"), "c");
  let firstParent: string[] = [];
  let incStore = new Store();
  let fulls = 0;

  beforeAll(async () => {
    const info = generateRepo(originDir, 110);
    expect(info.merges).toBeGreaterThanOrEqual(3);
    firstParent = g(originDir, [
      "rev-list",
      "--first-parent",
      "--reverse",
      "main",
    ])
      .trim()
      .split("\n");
    await git.clone(fileUrl(originDir), incDir, "main");
    g(incDir, ["config", "user.name", "Syn Thetic"]);
    g(incDir, ["config", "user.email", "a@example.com"]);
  }, 60_000);

  async function compare(label: string): Promise<void> {
    if (!(await incrementalHistory(git, incDir, incStore))) {
      fulls++;
      incStore = await fullHistory(git, incDir);
    }
    const ref = await fullHistory(git, incDir);
    const [a, b] = [incStore.dump(), ref.dump()];
    if (a !== b) {
      const x = JSON.parse(a) as { versions: unknown[] };
      const y = JSON.parse(b) as { versions: unknown[] };
      throw new Error(
        `${label}: incremental differs from full (${x.versions.length} vs ${y.versions.length} rows)`,
      );
    }
  }

  it("(a1) incremental after replaying real history in small pushes equals a full rebuild", async () => {
    let pos = Math.floor(firstParent.length * 0.4);
    await git.resetHard(incDir, firstParent[pos] as string);
    incStore = await fullHistory(git, incDir);
    const sizes = [1, 7, 2, 1, 4, 1, 3];
    let steps = 0;
    for (let k = 0; pos < firstParent.length - 1; k++) {
      pos = Math.min(
        firstParent.length - 1,
        pos + (sizes[k % sizes.length] as number),
      );
      await git.resetHard(incDir, firstParent[pos] as string);
      await compare(`replay@${pos}`);
      steps++;
    }
    expect(steps).toBeGreaterThan(15);
    expect(fulls).toBe(0);
    // And the final state equals a rebuild made from the origin itself.
    expect(incStore.dump()).toBe((await fullHistory(git, originDir)).dump());
  });

  const synthetic: [string, () => void][] = [
    [
      "10-file single commit",
      () => {
        const ls = g(incDir, ["ls-files", "-z", "*.txt"])
          .split("\0")
          .filter((p) => /^[^/]+\/[^/]+\.txt$/.test(p))
          .slice(0, 10);
        expect(ls).toHaveLength(10);
        for (const p of ls)
          write(
            incDir,
            p,
            g(incDir, ["show", `HEAD:${p}`]) + "1 Extra [LEA]\n",
          );
        commitAll(incDir, "bulk edit 10 files");
      },
    ],
    [
      "multi-commit push: rename, rename again, rename+edit, primer later",
      () => {
        write(incDir, "budget/Alpha deck.txt", deckBody(1));
        write(incDir, "budget/Alpha deck.md", "# primer\nline\n");
        commitAll(incDir, "add Alpha");
        mv(incDir, "budget/Alpha deck.txt", "budget/Beta ★ deck.txt");
        mv(incDir, "budget/Alpha deck.md", "budget/Beta ★ deck.md");
        commitAll(incDir, "rename to Beta");
        mv(incDir, "budget/Beta ★ deck.txt", "peasant/Gamma.txt");
        write(
          incDir,
          "peasant/Gamma.txt",
          deckBody(1).replace("Card 3 ", "Card X "),
        );
        commitAll(incDir, "rename+edit to peasant/Gamma");
        mv(incDir, "budget/Beta ★ deck.md", "peasant/Gamma.md");
        commitAll(incDir, "move primer next commit");
        write(incDir, "peasant/Gamma.txt", deckBody(1));
        commitAll(incDir, "edit after rename");
      },
    ],
    [
      "delete then re-add in one push",
      () => {
        g(incDir, ["rm", "-q", "peasant/Gamma.txt"]);
        commitAll(incDir, "delete Gamma");
        write(incDir, "peasant/Gamma.txt", deckBody(3));
        commitAll(incDir, "re-add Gamma");
      },
    ],
    [
      "rename a->b and add a new a in the same commit",
      () => {
        mv(incDir, "peasant/Gamma.txt", "peasant/Delta.txt");
        write(incDir, "peasant/Gamma.txt", deckBody(9));
        commitAll(incDir, "a->b plus new a");
      },
    ],
    [
      "swap two deck names",
      () => {
        write(incDir, "budget/S1.txt", deckBody(11));
        write(incDir, "budget/S2.txt", deckBody(12));
        commitAll(incDir, "add S1 S2");
        mv(incDir, "budget/S1.txt", "budget/tmp.txt");
        mv(incDir, "budget/S2.txt", "budget/S1.txt");
        mv(incDir, "budget/tmp.txt", "budget/S2.txt");
        commitAll(incDir, "swap S1 S2");
      },
    ],
    [
      "across the filter boundary: nested folder, repo root, .bak, txt to md, and back",
      () => {
        for (const [i, n] of ["B1", "B2", "B3", "B4"].entries())
          write(incDir, `budget/${n}.txt`, deckBody(21 + i));
        commitAll(incDir, "add B1-B4");
        mv(incDir, "budget/B1.txt", "budget/sub/B1.txt");
        mv(incDir, "budget/B2.txt", "B2.txt");
        mv(incDir, "budget/B3.txt", "budget/B3.bak");
        mv(incDir, "budget/B4.txt", "budget/B4.md");
        commitAll(incDir, "boundary moves");
        mv(incDir, "budget/sub/B1.txt", "budget/B1.txt");
        mv(incDir, "B2.txt", "budget/B2.txt");
        mv(incDir, "budget/B3.bak", "budget/B3.txt");
        commitAll(incDir, "and back");
      },
    ],
    [
      "--no-ff merge of a feature branch with a rename",
      () => {
        g(incDir, ["checkout", "-q", "-b", "feat/x"]);
        mv(incDir, "budget/B1.txt", "budget/B1 renamed.txt");
        commitAll(incDir, "feat rename");
        write(incDir, "budget/B1 renamed.txt", deckBody(31));
        commitAll(incDir, "feat edit");
        g(incDir, ["checkout", "-q", "main"]);
        write(incDir, "README.md", "x\n");
        commitAll(incDir, "readme");
        g(incDir, ["merge", "-q", "--no-ff", "-m", "Merge feat/x", "feat/x"]);
      },
    ],
    [
      "a commit that touches only non-deck files and a nested deck",
      () => {
        write(incDir, "formats/y.yaml", "a: 1\n");
        write(incDir, "budget/sub/N.txt", "nested\n");
        commitAll(incDir, "non deck");
      },
    ],
  ];
  for (const [name, fn] of synthetic) {
    it(`(a2) incremental equals full after a synthetic push: ${name}`, async () => {
      fn();
      await compare(`synthetic: ${name}`);
    });
  }

  it("(a3) a force-push makes the incremental update impossible", async () => {
    const before = incStore.lastCommit;
    expect(before).not.toBeNull();
    g(incDir, ["reset", "-q", "--hard", "HEAD~3"]);
    write(incDir, "budget/force.txt", deckBody(5));
    commitAll(incDir, "force-pushed history");
    expect(await incrementalHistory(git, incDir, incStore)).toBe(false);
    incStore = await fullHistory(git, incDir);
    expect(incStore.lastCommit).not.toBe(before);
  });

  // ---- checks on the origin's final history
  let store = new Store();
  const live = (): [number, string][] =>
    [...store.decks].filter((d): d is [number, string] => d[1] !== null);

  it("(setup) the full rebuild has one seq per kept commit, with no gaps", async () => {
    store = await fullHistory(git, originDir);
    const seqs = [...new Set(store.versions.map((v) => v.seq))];
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(store.lastSeq).toBe(seqs.length);
    const perSeq = new Map<number, Set<string>>();
    for (const v of store.versions)
      perSeq.set(v.seq, (perSeq.get(v.seq) ?? new Set()).add(v.commitSha));
    expect([...perSeq.values()].every((s) => s.size === 1)).toBe(true);
    expect(store.versions.length).toBeGreaterThan(100);
  });

  it("(b1) a deck renamed two or more times keeps one deck_id and all versions", () => {
    const counts = new Map<number, number>();
    for (const v of store.versions) {
      if (v.kind === "txt" && v.status === "R")
        counts.set(v.deckId, (counts.get(v.deckId) ?? 0) + 1);
    }
    const twice = [...counts].filter(([, n]) => n >= 2);
    expect(twice.length).toBeGreaterThan(0);
    const id = (twice[0] as [number, number])[0];
    const paths = new Set(
      store.versions
        .filter((v) => v.deckId === id && v.kind === "txt")
        .map((v) => v.pathAtCommit),
    );
    expect(paths.size).toBeGreaterThanOrEqual(3);
  });

  it("(b2) versions are the newest commits of git log --follow for every live deck", () => {
    expect(live().length).toBeGreaterThan(10);
    for (const [deckId, stem] of live()) {
      const mine = new Set(
        store.versions
          .filter((v) => v.deckId === deckId && v.kind === "txt")
          .map((v) => v.commitSha),
      );
      const follow = g(originDir, [
        "log",
        "--first-parent",
        "--follow",
        "-M",
        "--format=%H",
        "--",
        `${stem}.txt`,
      ])
        .trim()
        .split("\n")
        .filter(Boolean);
      // --follow may continue past the creation commit into a "copy source", so compare the newest N.
      expect(
        follow.slice(0, mine.size).every((h) => mine.has(h)),
        stem,
      ).toBe(true);
      expect(follow.length).toBeGreaterThanOrEqual(mine.size);
    }
  });

  it("(c) delete then re-add of the same path gets a new deck_id", () => {
    const dels = store.versions.filter(
      (v) => v.kind === "txt" && v.status === "D",
    );
    let readded = 0;
    for (const d of dels) {
      const later = store.versions.filter(
        (v) =>
          v.kind === "txt" &&
          v.status === "A" &&
          v.pathAtCommit === d.pathAtCommit &&
          v.seq > d.seq,
      );
      if (later.length > 0) {
        readded++;
        expect(later.every((v) => v.deckId !== d.deckId)).toBe(true);
      }
    }
    expect(dels.length).toBeGreaterThanOrEqual(3);
    expect(readded).toBeGreaterThanOrEqual(1);
  });

  it("(d1) a merge is one version per deck and kind, equal to its diff against the first parent", async () => {
    const merges = new Set(
      g(originDir, ["rev-list", "--first-parent", "--merges", "main"])
        .trim()
        .split("\n"),
    );
    const dup = new Map<string, number>();
    for (const v of store.versions) {
      const k = `${v.commitSha}|${v.deckId}|${v.kind}`;
      dup.set(k, (dup.get(k) ?? 0) + 1);
    }
    expect([...dup.values()].every((n) => n === 1)).toBe(true);
    const recs = (await git.logHistory(originDir, "main")).filter(
      (r) => merges.has(r.sha) && r.entries.length > 0,
    );
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (const r of recs) {
      const ref = g(originDir, [
        "diff-tree",
        "-r",
        "-M",
        "--raw",
        "-z",
        "--no-abbrev",
        `${r.sha}^1`,
        r.sha,
        "--",
        "*.txt",
        "*.md",
      ])
        .split("\0")
        .filter((x) => x !== "" && !x.startsWith(":"))
        .sort()
        .join("|");
      const got = r.entries
        .flatMap((e) =>
          [e.path, e.path2].filter((x): x is string => x !== undefined),
        )
        .sort()
        .join("|");
      expect(got).toBe(ref);
    }
  });

  it("(d2) a merge version carries the merge commit's own author and time", () => {
    const merges = new Set(
      g(originDir, ["rev-list", "--first-parent", "--merges", "main"])
        .trim()
        .split("\n"),
    );
    const v = store.versions.find((x) => merges.has(x.commitSha));
    expect(v).toBeDefined();
    const sha = (v as { commitSha: string }).commitSha;
    expect(v?.authorName).toBe("Merge Bot");
    expect(g(originDir, ["log", "-1", "--format=%an", `${sha}^2`]).trim()).toBe(
      "Dee Dvorak",
    );
    expect(v?.authorTs).toBe(
      Number(g(originDir, ["log", "-1", "--format=%at", sha]).trim()),
    );
    expect(v?.authorDate).toBe(
      g(originDir, ["log", "-1", "--format=%aI", sha]).trim(),
    );
  });

  it("(e) every stored commit and path resolves to the stored blob, spaces and Unicode included", async () => {
    const rows = store.versions.filter((v) => v.blobSha !== null);
    const input =
      rows.map((r) => `${r.commitSha}:${r.pathAtCommit}`).join("\n") + "\n";
    const res = spawnSync("git", ["cat-file", "--batch-check"], {
      cwd: originDir,
      input,
      maxBuffer: 1 << 28,
    })
      .stdout.toString()
      .trim()
      .split("\n");
    const bad = res.filter(
      (l, i) => !l.startsWith(`${rows[i]?.blobSha ?? "?"} blob`),
    );
    expect(bad).toEqual([]);
    expect(rows.some((r) => /[^ -~]/.test(r.pathAtCommit))).toBe(true);
    expect(rows.some((r) => /\s/.test(r.pathAtCommit))).toBe(true);
    // The same blobs read through the long-lived process.
    const cat = git.catFile(originDir);
    for (const r of rows.slice(0, 25)) {
      expect(await cat.read(r.blobSha as string)).toBe(
        g(originDir, ["show", `${r.commitSha}:${r.pathAtCommit}`]),
      );
    }
    await cat.close();
  });

  it("(f) the newest version of each live deck matches HEAD, with no leaked or nested paths", () => {
    for (const [deckId, stem] of live()) {
      for (const kind of ["txt", "md"] as const) {
        const last = store.versions
          .filter((v) => v.deckId === deckId && v.kind === kind)
          .at(-1);
        const head = spawnSync(
          "git",
          ["rev-parse", "-q", "--verify", `HEAD:${stem}.${kind}`],
          { cwd: originDir },
        )
          .stdout.toString()
          .trim();
        if (last === undefined || last.status === "D")
          expect(head, `${stem}.${kind}`).toBe("");
        else expect(last.blobSha, `${stem}.${kind}`).toBe(head);
      }
    }
    const leaked = store.versions.filter(
      (v) =>
        !/^[^/]+\/[^/]+\.(txt|md)$/.test(v.pathAtCommit) ||
        v.pathAtCommit.startsWith("formats/"),
    );
    expect(leaked).toEqual([]);
    const atHead = g(originDir, ["ls-tree", "-r", "--name-only", "-z", "HEAD"])
      .split("\0")
      .filter((p) => /^[^/]+\/[^/]+\.txt$/.test(p));
    expect(live().length).toBe(atHead.length);
  });
});

describe("history with the wrapper on a tiny repo", () => {
  it("rebuilds the same rows in one pass or in two", async () => {
    const git = newGit();
    const dir = tmp("tiny-");
    g(dir, ["init", "-q", "-b", "main"]);
    g(dir, ["config", "user.name", "Syn Thetic"]);
    g(dir, ["config", "user.email", "a@example.com"]);
    write(dir, "g/a.txt", deckBody(1));
    const c1 = commitAll(dir, "one");
    write(dir, "g/a.txt", deckBody(2));
    commitAll(dir, "two");
    const full = await fullHistory(git, dir);
    expect(full.lastSeq).toBe(2);
    const part = await fullHistory(git, dir, c1);
    expect(await incrementalHistory(git, dir, part)).toBe(true);
    expect(await incrementalHistory(git, dir, part)).toBe(true); // already at head
    expect(part.dump()).toBe(full.dump());
  });
});
