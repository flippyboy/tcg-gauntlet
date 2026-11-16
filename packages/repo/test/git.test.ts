import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Git,
  GitError,
  gitConfigArgs,
  gitEnv,
  parseNameStatus,
} from "../src/index.js";
import {
  commitAll,
  fileUrl,
  g,
  initRepo,
  newGit,
  readText,
  tmp,
  write,
} from "./helpers.js";

const savedEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

function origin(): { dir: string; first: string } {
  const dir = tmp("origin-");
  initRepo(dir);
  write(dir, "g/a.txt", "4 Card A\n");
  write(dir, "g/gauntlet.yaml", "name: x\nformat: modern\n");
  return { dir, first: commitAll(dir, "first") };
}

describe("git environment and flags", () => {
  it("builds the environment from PATH and LANG plus the fixed settings", () => {
    process.env["PATH"] = "/usr/bin";
    process.env["LANG"] = "C.UTF-8";
    process.env["GIT_DIR"] = "/elsewhere";
    process.env["GIT_SSH_COMMAND"] = "evil";
    process.env["HTTPS_PROXY"] = "http://proxy";
    expect(gitEnv({ dataDir: "/data" })).toEqual({
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      HOME: "/data/home",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ALLOW_PROTOCOL: "https",
    });
  });

  it("leaves out PATH and LANG when the parent has none", () => {
    delete process.env["LANG"];
    expect(Object.keys(gitEnv({ dataDir: "/d" }))).not.toContain("LANG");
  });

  it("changes only the two protocol settings in test mode", () => {
    const a = gitEnv({ dataDir: "/d" });
    const b = gitEnv({ dataDir: "/d", testMode: true });
    expect(b["GIT_ALLOW_PROTOCOL"]).toBe("https:http:file");
    expect({ ...b, GIT_ALLOW_PROTOCOL: "https" }).toEqual(a);
    const fa = gitConfigArgs("/r", { dataDir: "/d" });
    const fb = gitConfigArgs("/r", { dataDir: "/d", testMode: true });
    expect(fa).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "http.followRedirects=false",
      "-c",
      "safe.directory=/r",
    ]);
    expect(fb.map((x) => x.replace("always", "never"))).toEqual(fa);
  });

  it("ignores global config: an insteadOf rule in HOME has no effect", async () => {
    const a = origin();
    const b = origin();
    write(b.dir, "g/b.txt", "4 Card B\n");
    const bSha = commitAll(b.dir, "b only");
    const home = tmp("home-");
    writeFileSync(
      join(home, ".gitconfig"),
      `[url "${fileUrl(b.dir)}"]\n\tinsteadOf = ${fileUrl(a.dir)}\n`,
    );
    process.env["HOME"] = home;
    process.env["XDG_CONFIG_HOME"] = home;
    process.env["GIT_CONFIG_GLOBAL"] = join(home, ".gitconfig");

    // The premise: plain git with this environment is redirected to b.
    const probe = tmp("probe-");
    const plain = spawnSync(
      "git",
      ["clone", "-q", fileUrl(a.dir), join(probe, "c")],
      {
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
    expect(plain.status).toBe(0);
    expect(g(join(probe, "c"), ["rev-parse", "HEAD"]).trim()).toBe(bSha);

    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(a.dir), dir);
    expect(await git.revParse(dir, "HEAD")).toBe(a.first);
  });

  it("refuses file:// outside test mode", async () => {
    const { dir } = origin();
    const git = newGit(false);
    const target = join(tmp("clone-"), "c");
    const err = await git.clone(fileUrl(dir), target).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).stderr).toMatch(
      /not allowed|disallowed|protocol/i,
    );
    expect(existsSync(join(target, ".git"))).toBe(false);
  });

  it("does not run hooks", async () => {
    const o = origin();
    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(o.dir), dir);
    const hook = join(dir, ".git", "hooks", "reference-transaction");
    writeFileSync(hook, `#!/bin/sh\ntouch "${dir}/hook-ran"\n`);
    chmodSync(hook, 0o755);
    // The premise: git runs the hook when a ref moves.
    g(dir, ["commit", "-q", "--allow-empty", "-m", "x"]);
    expect(existsSync(join(dir, "hook-ran"))).toBe(true);
    rmSync(join(dir, "hook-ran"));
    await git.resetHard(dir, o.first);
    expect(existsSync(join(dir, "hook-ran"))).toBe(false);
  });

  it("rejects unsafe branch names and revisions", async () => {
    const git = newGit();
    await expect(git.fetch("/nowhere", "--upload-pack=x")).rejects.toThrow(
      /Unsafe branch/,
    );
    await expect(git.lsRemote("/nowhere", "a b")).rejects.toThrow(
      /Unsafe branch/,
    );
    await expect(git.revParse("/nowhere", "-x")).rejects.toThrow(
      /Unsafe revision/,
    );
    await expect(git.logHistory("/nowhere", "--all")).rejects.toThrow(
      /Unsafe revision/,
    );
    await expect(git.clone("file:///x", "/y", "../z")).rejects.toThrow(
      /Unsafe branch/,
    );
  });

  it("reports a git that cannot start", async () => {
    const saved = process.env["PATH"];
    process.env["PATH"] = "/nonexistent";
    const git = newGit();
    await expect(git.isAncestor(tmp(), "a", "b")).rejects.toThrow();
    process.env["PATH"] = saved;
  });
});

describe("clone, fetch, ls-remote and friends", () => {
  it("clones a branch, fetches new commits and resets to them", async () => {
    const o = origin();
    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(o.dir), dir, "main");
    expect(readText(dir, "g/a.txt")).toBe("4 Card A\n");

    write(o.dir, "g/a.txt", "3 Card A\n");
    const second = commitAll(o.dir, "second");
    expect(await git.lsRemote(dir, "main")).toEqual({ sha: second });
    await git.fetch(dir, "main");
    expect(await git.revParse(dir, "origin/main")).toBe(second);
    expect(readText(dir, "g/a.txt")).toBe("4 Card A\n");
    await git.resetHard(dir, second);
    expect(readText(dir, "g/a.txt")).toBe("3 Card A\n");
    expect(await git.isRepoHealthy(dir)).toBe(true);
  });

  it("does not follow submodules when cloning", async () => {
    const sub = origin();
    const o = origin();
    g(o.dir, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      fileUrl(sub.dir),
      "mod",
    ]);
    commitAll(o.dir, "add submodule");
    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(o.dir), dir);
    expect(readdirSync(join(dir, "mod"))).toEqual([]);
  });

  it("returns an error from ls-remote for a missing branch and a broken remote", async () => {
    const o = origin();
    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(o.dir), dir);
    const missing = await git.lsRemote(dir, "nope");
    expect(missing).toMatchObject({ throttled: false });
    expect("error" in missing).toBe(true);
    g(dir, ["remote", "set-url", "origin", fileUrl(join(tmp(), "gone"))]);
    const broken = await git.lsRemote(dir, "main");
    expect(broken).toMatchObject({ throttled: false });
    expect("error" in broken).toBe(true);
  });

  it("marks 429 and 5xx answers as throttled", async () => {
    const status = { code: 503 };
    const server = createServer((_req, res) => {
      res.statusCode = status.code;
      res.end("slow down");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const o = origin();
      const git = newGit();
      const dir = join(tmp("clone-"), "c");
      await git.clone(fileUrl(o.dir), dir);
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x.git`;
      g(dir, ["remote", "set-url", "origin", url]);
      for (const code of [503, 429]) {
        status.code = code;
        const r = await git.lsRemote(dir, "main");
        expect(r).toMatchObject({ throttled: true });
      }
      status.code = 404;
      expect(await git.lsRemote(dir, "main")).toMatchObject({
        throttled: false,
      });
    } finally {
      server.close();
    }
  });

  it("isAncestor is false after a force-push and for a missing object", async () => {
    const o = origin();
    write(o.dir, "g/b.txt", "1 B\n");
    const old = commitAll(o.dir, "old tip");
    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(o.dir), dir);
    expect(await git.isAncestor(dir, o.first, old)).toBe(true);
    expect(await git.isAncestor(dir, old, o.first)).toBe(false);

    // Force-push: the remote drops "old tip" and gets a different commit.
    g(o.dir, ["reset", "-q", "--hard", o.first]);
    write(o.dir, "g/c.txt", "1 C\n");
    const rewritten = commitAll(o.dir, "rewritten");
    await git.fetch(dir, "main");
    await git.resetHard(dir, rewritten);
    expect(await git.isAncestor(dir, old, rewritten)).toBe(false);

    // Once the old objects are gone, the SHA is a missing object.
    g(dir, ["reflog", "expire", "--expire=now", "--all"]);
    g(dir, ["gc", "-q", "--prune=now"]);
    expect(
      spawnSync("git", ["cat-file", "-e", old], { cwd: dir }).status,
    ).not.toBe(0);
    expect(await git.isAncestor(dir, old, rewritten)).toBe(false);
    expect(
      await git.isAncestor(
        dir,
        "0123456789abcdef0123456789abcdef01234567",
        rewritten,
      ),
    ).toBe(false);
  });

  it("lists changes with three-dot semantics, renames and all statuses", async () => {
    const o = origin();
    write(o.dir, "g/del.txt", "1 Del\n");
    write(
      o.dir,
      "g/old.txt",
      Array.from({ length: 20 }, (_, i) => `1 Keep ${i}`).join("\n") + "\n",
    );
    write(o.dir, "g/mod.txt", "1 Mod\n");
    const base = commitAll(o.dir, "base");
    g(o.dir, ["checkout", "-q", "-b", "side"]);
    g(o.dir, ["rm", "-q", "g/del.txt"]);
    g(o.dir, ["mv", "g/old.txt", "g/ñew name.txt"]);
    write(o.dir, "g/mod.txt", "2 Mod\n");
    write(o.dir, "g/add.txt", "1 Add\n");
    commitAll(o.dir, "side changes");
    g(o.dir, ["checkout", "-q", "main"]);
    write(o.dir, "g/mainonly.txt", "1 Main\n");
    commitAll(o.dir, "main moves on");
    const git = newGit();
    const changes = await git.diffNameStatus(o.dir, "main", "side");
    expect(changes.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { status: "A", path: "g/add.txt" },
      { status: "D", path: "g/del.txt" },
      { status: "M", path: "g/mod.txt" },
      { status: "R", path: "g/ñew name.txt", oldPath: "g/old.txt" },
    ]);
    expect(await git.diffNameStatus(o.dir, base, "HEAD")).toEqual([
      { status: "A", path: "g/mainonly.txt" },
    ]);
  });

  it("parses name-status output", () => {
    expect(
      parseNameStatus("A\0a\0T\0t\0R087\0o\0n\0C100\0src\0copy\0D\0d\0\0"),
    ).toEqual([
      { status: "A", path: "a" },
      { status: "M", path: "t" },
      { status: "R", path: "n", oldPath: "o" },
      { status: "A", path: "copy" },
      { status: "D", path: "d" },
    ]);
    expect(parseNameStatus("")).toEqual([]);
  });

  it("reports a repo with a missing object as unhealthy", async () => {
    const o = origin();
    const git = newGit();
    const dir = join(tmp("clone-"), "c");
    await git.clone(fileUrl(o.dir), dir);
    expect(await git.isRepoHealthy(dir)).toBe(true);
    // A clone over file:// keeps its objects in a pack. Without it the refs point at nothing.
    const objDir = join(dir, ".git", "objects", "pack");
    for (const f of readdirSync(objDir)) rmSync(join(objDir, f));
    expect(await git.isRepoHealthy(dir)).toBe(false);
  });
});

describe("CatFile", () => {
  it("reads blobs in order, including Unicode and large ones", async () => {
    const o = origin();
    const big = "1 ★ Niño ".repeat(30000);
    write(o.dir, "g/big.txt", big);
    write(o.dir, "g/日本語.txt", "4 日本語\n");
    commitAll(o.dir, "more");
    const sha = (p: string): string =>
      g(o.dir, ["rev-parse", `HEAD:${p}`]).trim();
    const git = newGit();
    const cat = git.catFile(o.dir);
    const [a, b, c] = await Promise.all([
      cat.read(sha("g/a.txt")),
      cat.read(sha("g/big.txt")),
      cat.read(sha("g/日本語.txt")),
    ]);
    expect(a).toBe("4 Card A\n");
    expect(b).toBe(big);
    expect(c).toBe("4 日本語\n");
    await cat.close();
  });

  it("rejects a missing object and keeps working", async () => {
    const o = origin();
    const git = newGit();
    const cat = git.catFile(o.dir);
    await expect(
      cat.read("0123456789abcdef0123456789abcdef01234567"),
    ).rejects.toThrow(/not in the repository/);
    await expect(cat.read("not-a-sha")).rejects.toThrow(/Not an object id/);
    expect(await cat.read(g(o.dir, ["rev-parse", "HEAD:g/a.txt"]).trim())).toBe(
      "4 Card A\n",
    );
    await cat.close();
    await expect(
      cat.read(g(o.dir, ["rev-parse", "HEAD:g/a.txt"]).trim()),
    ).rejects.toThrow(/closed/);
  });

  it("fails reads when git cannot start", async () => {
    const saved = process.env["PATH"];
    process.env["PATH"] = "/nonexistent";
    const cat = new Git({ dataDir: tmp("data-") }).catFile(tmp());
    process.env["PATH"] = saved;
    await expect(
      cat.read("0123456789abcdef0123456789abcdef01234567"),
    ).rejects.toThrow();
    await cat.close();
  });
});
