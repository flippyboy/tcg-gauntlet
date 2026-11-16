import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseHistoryLog } from "./history.js";
import type { Change, HistoryRecord } from "./types.js";

/** Largest output of one git call (design item 52). */
const MAX_BUFFER = 64 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 10 * 60 * 1000;
const FSCK_TIMEOUT_MS = 60 * 1000;

export interface GitOptions {
  /** `DATA_DIR`. Git's `HOME` is `<dataDir>/home`. */
  dataDir: string;
  /**
   * Test mode (`ALLOW_INSECURE_TEST_REPO_URL`). Allows the `http` and `file`
   * protocols. Nothing else changes.
   */
  testMode?: boolean;
}

/**
 * The environment of every git call (Technical Plan, Security). It starts from
 * `PATH` and `LANG` of this process, so no other variable leaks in.
 */
export function gitEnv(opts: GitOptions): Record<string, string> {
  const env: Record<string, string> = {};
  const path = process.env["PATH"];
  const lang = process.env["LANG"];
  if (path !== undefined) env["PATH"] = path;
  if (lang !== undefined) env["LANG"] = lang;
  env["HOME"] = join(opts.dataDir, "home");
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  env["GIT_ALLOW_PROTOCOL"] =
    opts.testMode === true ? "https:http:file" : "https";
  return env;
}

/** The `-c` flags that go before the subcommand of every call. */
export function gitConfigArgs(repoDir: string, opts: GitOptions): string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    `protocol.file.allow=${opts.testMode === true ? "always" : "never"}`,
    "-c",
    "http.followRedirects=false",
    "-c",
    `safe.directory=${repoDir}`,
  ];
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    /** The exit code, or a string such as `ENOENT` when git did not run. */
    readonly code: number | string | undefined,
  ) {
    super(message);
    this.name = "GitError";
  }
}

interface RunOptions {
  timeout?: number;
}

const REF_RE = /^[A-Za-z0-9._/-]+$/;
const REV_RE = /^[A-Za-z0-9._/~^@{}-]+$/;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

function checkBranch(branch: string): void {
  if (!REF_RE.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error(`Unsafe branch name: ${JSON.stringify(branch)}`);
  }
}

function checkRev(rev: string): void {
  if (!REV_RE.test(rev) || rev.startsWith("-")) {
    throw new Error(`Unsafe revision: ${JSON.stringify(rev)}`);
  }
}

/** The history pass command (Technical Plan, "One history pass"), without the range. */
export const HISTORY_LOG_ARGS = [
  "-c",
  "diff.renameLimit=0",
  "log",
  "--first-parent",
  "--reverse",
  "-z",
  "--no-abbrev",
  "--raw",
  "-M",
  "--format=%x1e%H%x1f%an%x1f%aI%x1f%at%x1f%cI%x1f%s",
];

export const HISTORY_PATHSPEC = ["--", "*.txt", "*.md"];

export class Git {
  constructor(readonly opts: GitOptions) {}

  private run(
    repoDir: string,
    cwd: string,
    args: string[],
    ro: RunOptions = {},
  ): Promise<{ stdout: string; stderr: string }> {
    mkdirSync(join(this.opts.dataDir, "home"), { recursive: true });
    const full = [...gitConfigArgs(repoDir, this.opts), ...args];
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        full,
        {
          cwd,
          env: gitEnv(this.opts),
          maxBuffer: MAX_BUFFER,
          encoding: "utf8",
          timeout: ro.timeout ?? 0,
        },
        (err, stdout, stderr) => {
          if (err === null) {
            resolve({ stdout, stderr });
            return;
          }
          const code = (err as { code?: number | string }).code;
          reject(
            new GitError(
              `git ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || err.message}`,
              stderr,
              code,
            ),
          );
        },
      );
    });
  }

  /** Clones `url` into `dir` and checks out `branch`. Submodules are not fetched. */
  async clone(url: string, dir: string, branch?: string): Promise<void> {
    const args = ["clone", "--no-recurse-submodules"];
    if (branch !== undefined) {
      checkBranch(branch);
      args.push("--branch", branch);
    }
    args.push("--", url, dir);
    mkdirSync(this.opts.dataDir, { recursive: true });
    await this.run(dir, this.opts.dataDir, args, {
      timeout: NETWORK_TIMEOUT_MS,
    });
  }

  /**
   * Fetches the tracked branch into `refs/remotes/origin/<branch>`. A forced
   * update, so a force-push does not fail the fetch.
   */
  async fetch(dir: string, branch: string): Promise<void> {
    checkBranch(branch);
    await this.run(
      dir,
      dir,
      [
        "fetch",
        "--no-recurse-submodules",
        "--no-tags",
        "origin",
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      { timeout: NETWORK_TIMEOUT_MS },
    );
  }

  /** Resets the work tree and the checked-out branch to `rev`. */
  async resetHard(dir: string, rev: string): Promise<void> {
    checkRev(rev);
    await this.run(dir, dir, ["reset", "--hard", "--quiet", rev]);
  }

  /** The tip of `branch` on `origin`, or the reason it could not be read. */
  async lsRemote(
    dir: string,
    branch: string,
  ): Promise<{ sha: string } | { error: string; throttled: boolean }> {
    checkBranch(branch);
    try {
      const { stdout } = await this.run(
        dir,
        dir,
        ["ls-remote", "origin", `refs/heads/${branch}`],
        { timeout: 60 * 1000 },
      );
      const sha = stdout.split("\t")[0]?.trim() ?? "";
      if (!SHA_RE.test(sha)) {
        return {
          error: `Branch ${branch} not found on the remote`,
          throttled: false,
        };
      }
      return { sha };
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
      return {
        error: e.message,
        throttled: /\b(429|5\d\d)\b/.test(e.stderr),
      };
    }
  }

  /** Resolves a revision to a commit SHA. */
  async revParse(dir: string, rev: string): Promise<string> {
    checkRev(rev);
    const { stdout } = await this.run(dir, dir, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${rev}^{commit}`,
    ]);
    return stdout.trim();
  }

  /** True when `a` is an ancestor of `b`. A missing object gives false. */
  async isAncestor(dir: string, a: string, b: string): Promise<boolean> {
    checkRev(a);
    checkRev(b);
    try {
      await this.run(dir, dir, ["merge-base", "--is-ancestor", a, b]);
      return true;
    } catch (e) {
      // Exit 1 is "not an ancestor", 128 is "no such object". Anything else
      // (git missing, a timeout) is a real failure.
      if (e instanceof GitError && typeof e.code === "number") return false;
      throw e;
    }
  }

  /** `git diff --name-status -z -M <base>...<head>` as a list of changes. */
  async diffNameStatus(
    dir: string,
    base: string,
    head = "HEAD",
  ): Promise<Change[]> {
    checkRev(base);
    checkRev(head);
    const { stdout } = await this.run(dir, dir, [
      "-c",
      "diff.renameLimit=0",
      "diff",
      "--name-status",
      "-z",
      "-M",
      `${base}...${head}`,
    ]);
    return parseNameStatus(stdout);
  }

  /** Runs the history pass over `range` and returns the parsed commits. */
  async logHistory(dir: string, range: string): Promise<HistoryRecord[]> {
    checkRev(range);
    const { stdout } = await this.run(dir, dir, [
      ...HISTORY_LOG_ARGS,
      range,
      ...HISTORY_PATHSPEC,
    ]);
    return parseHistoryLog(stdout);
  }

  /** Starts one long-lived `git cat-file --batch` process. */
  catFile(dir: string): CatFile {
    mkdirSync(join(this.opts.dataDir, "home"), { recursive: true });
    return new CatFile(
      spawn("git", [...gitConfigArgs(dir, this.opts), "cat-file", "--batch"], {
        cwd: dir,
        env: gitEnv(this.opts),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  }

  /** `git fsck --connectivity-only`, with a 60 s timeout. */
  async isRepoHealthy(dir: string): Promise<boolean> {
    try {
      await this.run(dir, dir, ["fsck", "--connectivity-only"], {
        timeout: FSCK_TIMEOUT_MS,
      });
      return true;
    } catch (e) {
      if (e instanceof GitError) return false;
      throw e;
    }
  }
}

/** Parses `git diff --name-status -z -M` output. */
export function parseNameStatus(out: string): Change[] {
  const toks = out.split("\0");
  const changes: Change[] = [];
  let i = 0;
  while (i < toks.length) {
    const st = toks[i] ?? "";
    if (st === "") {
      i++;
      continue;
    }
    const letter = st[0];
    if (letter === "R" || letter === "C") {
      const oldPath = toks[i + 1] ?? "";
      const path = toks[i + 2] ?? "";
      i += 3;
      if (letter === "R") changes.push({ status: "R", path, oldPath });
      else changes.push({ status: "A", path });
      continue;
    }
    const path = toks[i + 1] ?? "";
    i += 2;
    if (letter === "A" || letter === "D")
      changes.push({ status: letter, path });
    else changes.push({ status: "M", path }); // M, T and anything else that touches a file
  }
  return changes;
}

interface Pending {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  sha: string;
}

/**
 * One `git cat-file --batch` process. Requests are answered in order, one at a
 * time, over the same process.
 */
export class CatFile {
  private buf: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private closed = false;
  private exited: Promise<void>;
  private stderr = "";

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.drain();
    });
    child.stderr.on("data", (d: Buffer) => {
      this.stderr += d.toString("utf8");
    });
    // A write to a dead process must not crash the server.
    child.stdin.on("error", () => undefined);
    this.exited = new Promise((resolve) => {
      child.on("error", (e) => {
        this.failAll(new Error(`git cat-file failed to start: ${e.message}`));
        resolve();
      });
      child.on("close", () => {
        this.failAll(
          new Error(
            `git cat-file exited${this.stderr ? `: ${this.stderr.trim()}` : ""}`,
          ),
        );
        resolve();
      });
    });
  }

  private failAll(err: Error): void {
    this.closed = true;
    const q = this.queue;
    this.queue = [];
    for (const p of q) p.reject(err);
  }

  private drain(): void {
    for (;;) {
      const head = this.queue[0];
      if (head === undefined) return;
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) return;
      const header = this.buf.subarray(0, nl).toString("utf8");
      if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
        this.buf = this.buf.subarray(nl + 1);
        this.queue.shift();
        head.reject(new Error(`Object ${head.sha} is not in the repository`));
        continue;
      }
      const size = Number(header.split(" ")[2]);
      if (!Number.isInteger(size)) {
        this.failAll(new Error(`Unexpected cat-file header: ${header}`));
        this.child.kill();
        return;
      }
      if (this.buf.length < nl + 1 + size + 1) return;
      const body = this.buf.subarray(nl + 1, nl + 1 + size);
      const text = body.toString("utf8");
      this.buf = this.buf.subarray(nl + 1 + size + 1);
      this.queue.shift();
      head.resolve(text);
    }
  }

  /** The content of the object `sha`, as UTF-8 text. */
  read(sha: string): Promise<string> {
    if (!SHA_RE.test(sha)) {
      return Promise.reject(
        new Error(`Not an object id: ${JSON.stringify(sha)}`),
      );
    }
    if (this.closed) return Promise.reject(new Error("git cat-file is closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, sha });
      this.child.stdin.write(`${sha}\n`);
    });
  }

  /** Ends the process after the pending reads are answered. */
  async close(): Promise<void> {
    this.closed = true;
    this.child.stdin.end();
    await this.exited;
  }
}
