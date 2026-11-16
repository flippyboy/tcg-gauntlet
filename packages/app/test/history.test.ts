import Database from "better-sqlite3";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Git } from "@tcg-gauntlet/repo";
import { History } from "../src/lib/server/history.js";
import { caseDeck, commit, git, makeRepo, tmp } from "./helpers.js";

const GY = "schema_version: 1\nname: T\nformat: preset:2015-modern@1\n";
const burn = caseDeck("legal-burn");

interface Dump {
  decks: unknown[];
  versions: unknown[];
  state: unknown[];
}

function dump(path: string): Dump {
  const db = new Database(path, { readonly: true });
  try {
    return {
      decks: db.prepare("SELECT * FROM decks ORDER BY deck_id").all(),
      versions: db
        .prepare("SELECT * FROM deck_versions ORDER BY deck_id, seq, kind")
        .all(),
      state: db.prepare("SELECT * FROM sync_state ORDER BY key").all(),
    };
  } finally {
    db.close();
  }
}

function setup(repo: string): { h: History; dbPath: string; git: Git } {
  const dataDir = tmp("hist-data-");
  const g = new Git({ dataDir, testMode: true });
  const dbPath = join(dataDir, "history.sqlite");
  const h = new History(g, dbPath, repo);
  h.open();
  return { h, dbPath, git: g };
}

const head = (repo: string): string => git(repo, ["rev-parse", "HEAD"]);

/** A full rebuild of the same repo into a fresh file, for comparison. */
async function fullDump(repo: string): Promise<Dump> {
  const f = setup(repo);
  try {
    expect(await f.h.update(head(repo))).toBe("full");
    return dump(f.dbPath);
  } finally {
    f.h.close();
  }
}

describe("history", () => {
  it("an incremental update equals a full rebuild, through renames and deletes", async () => {
    const repo = makeRepo({
      "g/gauntlet.yaml": GY,
      "g/a.txt": "4 Lightning Bolt\n",
    });
    const inc = setup(repo);
    expect(await inc.h.update(head(repo))).toBe("full");
    expect(await inc.h.update(head(repo))).toBe("none");

    const steps: Record<string, string | null>[] = [
      { "g/a.txt": "4 Lightning Bolt\n4 Char\n", "g/a.md": "primer\n" },
      { "g/b.txt": burn },
      { "g/a.txt": null, "g/c.txt": "4 Lightning Bolt\n4 Char\n" }, // rename
      { "g/c.md": null, "g/c.txt": "4 Lightning Bolt\n3 Char\n" },
      { "g/b.txt": null },
      { "g/b.txt": "2 Char\n" }, // a new deck on a deleted path
      {
        "g/c.txt": "x\n",
        "g/d/ignored.txt": "nope\n",
        "README.md": "readme\n",
      },
    ];
    for (const [i, files] of steps.entries()) {
      commit(repo, files, `step ${i}`);
      expect(await inc.h.update(head(repo))).toBe("incremental");
      expect(dump(inc.dbPath)).toEqual(await fullDump(repo));
    }
    const d = dump(inc.dbPath);
    // a -> c kept its deck id; b was deleted and re-added as a new deck.
    expect(d.decks).toEqual([
      { deck_id: 1, current_path: "g/c" },
      { deck_id: 2, current_path: null },
      { deck_id: 3, current_path: "g/b" },
    ]);
    expect(inc.h.versions("g/c", 100).map((v) => v.status)).toEqual([
      "M",
      "M",
      "R",
      "M",
      "A",
    ]);
    expect(inc.h.versions("g/c", 2)).toHaveLength(2);
    inc.h.close();
  });

  it("rebuilds after a force-push, and when the last commit object is missing", async () => {
    const repo = makeRepo({ "g/gauntlet.yaml": GY, "g/a.txt": "4 Char\n" });
    const first = head(repo);
    commit(repo, { "g/a.txt": "3 Char\n" }, "second");
    commit(repo, { "g/b.txt": "1 Char\n" }, "third");
    const h = setup(repo);
    expect(await h.h.update(head(repo))).toBe("full");

    git(repo, ["reset", "-q", "--hard", first]);
    commit(repo, { "g/z.txt": "2 Char\n" }, "diverged");
    expect(await h.h.update(head(repo))).toBe("full");
    expect(dump(h.dbPath)).toEqual(await fullDump(repo));
    expect(h.h.lastCommit()).toBe(head(repo));

    const db = new Database(h.dbPath);
    db.prepare("UPDATE sync_state SET value = ? WHERE key = 'last_commit'").run(
      "a".repeat(40),
    );
    db.close();
    // The handle must see the change: reopen.
    h.h.close();
    h.h.open();
    commit(repo, { "g/z.txt": "1 Char\n" }, "after");
    expect(await h.h.update(head(repo))).toBe("full");
    expect(dump(h.dbPath)).toEqual(await fullDump(repo));
    h.h.close();
  });

  it("starts over when the file is damaged", async () => {
    const repo = makeRepo({ "g/gauntlet.yaml": GY, "g/a.txt": "4 Char\n" });
    const h = setup(repo);
    await h.h.update(head(repo));
    h.h.close();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      h.dbPath,
      "this is not a database, it is just text ".repeat(100),
    );
    h.h.open();
    expect(h.h.lastCommit()).toBeNull();
    expect(await h.h.update(head(repo))).toBe("full");
    expect(h.h.versions("g/a", 10)).toHaveLength(1);
    h.h.close();
  });

  it("reports dates by author_ts and reads content through cat-file", async () => {
    const repo = makeRepo({
      "g/gauntlet.yaml": GY,
      "g/a.txt": burn,
      "g/a.md": "primer v1\n",
    });
    commit(repo, { "g/a.md": "primer v2\n" }, "primer only");
    commit(
      repo,
      { "g/a.txt": "---\nschema_version: 99\n---\n4 Char\n" },
      "bad schema",
    );
    const h = setup(repo);
    await h.h.update(head(repo));
    const vs = h.h.versions("g/a", 10);
    expect(vs.map((v) => v.subject)).toEqual([
      "bad schema",
      "primer only",
      "initial",
    ]);
    expect(vs[1]?.changed).toEqual(["md"]);
    expect(vs[1]?.txtBlob).toBe(vs[2]?.txtBlob);
    const last = h.h.lastUpdated("g/a");
    expect(last?.authorTs).toBe(vs[0]?.authorTs);
    expect(h.h.lastUpdated("g/none")).toBeNull();

    const good = await h.h.content(vs[2]?.txtBlob as string);
    expect(good.parsed?.lines.length).toBeGreaterThan(5);
    const again = await h.h.content(vs[2]?.txtBlob as string);
    expect(again).toBe(good); // cached
    const bad = await h.h.content(vs[0]?.txtBlob as string);
    expect(bad.parsed).toBeNull();
    expect(bad.text).toContain("schema_version: 99");
    expect(await h.h.rawText(vs[0]?.mdBlob as string)).toBe("primer v2\n");
    await expect(h.h.rawText("b".repeat(40))).rejects.toThrow(
      /not in the repository/,
    );
    await expect(h.h.rawText("nonsense")).rejects.toThrow(/Not an object/);
    h.h.close();
  });

  it("splits a primer that moves away from its deck", async () => {
    const repo = makeRepo({
      "g/gauntlet.yaml": GY,
      "g/a.txt": "4 Char\n",
      "g/a.md": "p\n",
    });
    commit(repo, { "g/a.md": null, "g/x.md": "p\n" }, "move primer");
    const h = setup(repo);
    await h.h.update(head(repo));
    expect(dump(h.dbPath)).toEqual(await fullDump(repo));
    h.h.close();
  });
});
