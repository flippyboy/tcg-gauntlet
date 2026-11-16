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
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixturesDir = `${repoRoot}conformance/fixtures/`;
export const casesDir = `${repoRoot}conformance/cases`;
export const presetsDir = `${repoRoot}presets`;

const dirs: string[] = [];

/** A fresh temp dir, removed after the test file. */
export function tmp(prefix = "validator-test-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The bytes of a conformance case deck. */
export const caseDeck = (name: string): Buffer =>
  readFileSync(`${casesDir}/${name}/deck.txt`);

/** Runs git with no global config. Returns stdout. */
export function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"],
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

export type Files = Record<string, string | Buffer | null>;

/** Writes `files` into `dir` (null deletes), then stages everything and commits. */
export function commit(dir: string, files: Files, message = "change"): void {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    if (body === null) {
      rmSync(abs, { force: true });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
}

/** A new deck repo: `git init -b main`, a local identity only, one commit. */
export function makeRepo(files: Files): string {
  const dir = tmp("deck-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  commit(dir, files, "initial");
  return dir;
}
