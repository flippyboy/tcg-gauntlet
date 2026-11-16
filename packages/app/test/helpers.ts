import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll } from "vitest";
import { type Config, parseConfig } from "../src/lib/server/config.js";
import { setLogLevel } from "../src/lib/server/logger.js";
import type { Clock } from "../src/lib/server/sync.js";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixturesDir = `${repoRoot}conformance/fixtures/`;
export const casesDir = `${repoRoot}conformance/cases`;
export const presetsDir = `${repoRoot}presets`;

const dirs: string[] = [];

export function tmp(prefix = "app-test-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export const caseDeck = (name: string): string =>
  readFileSync(`${casesDir}/${name}/deck.txt`, "utf8");

export function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"],
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: process.env["GIT_AUTHOR_DATE"] ?? "",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

export type Files = Record<string, string | null>;

let tick = 1_700_000_000;

/** Writes files (null deletes), stages everything, commits with a rising date. */
export function commit(dir: string, files: Files, message = "change"): string {
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
  const date = `${(tick += 3600)} +0000`;
  const r = spawnSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
  if (r.status !== 0) throw new Error(`git commit: ${r.stderr}`);
  return git(dir, ["rev-parse", "HEAD"]);
}

export function makeRepo(files: Files): string {
  const dir = tmp("deck-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "Test Author"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  commit(dir, files, "initial");
  return dir;
}

export const GAUNTLET =
  "schema_version: 1\nname: Test gauntlet\nformat: preset:2015-modern@1\n";

export const goodFiles = (): Files => ({
  "g/gauntlet.yaml": GAUNTLET,
  "g/gauntlet.md": "A test gauntlet.\n",
  "g/burn.txt": caseDeck("legal-burn"),
  "g/burn.md": "# Burn\n\nGo face. <script>alert(1)</script>\n",
});

// ------------------------------------------------------------ MTGJSON stand-in

export interface TestServer {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

let cached: { raw: Buffer; gz: Buffer } | undefined;
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** The mini fixture, served the way mtgjson.com serves AllPrintings. */
export async function startMtgjson(
  version = "5.3.0+20261115",
  date = "2026-11-15",
): Promise<TestServer> {
  if (cached === undefined) {
    const raw = readFileSync(`${fixturesDir}mini-allprintings.sqlite`);
    cached = { raw, gz: gzipSync(raw, { level: 1 }) };
  }
  const { raw, gz } = cached;
  const requests: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const path = req.url ?? "";
    requests.push(path);
    const body: Record<string, string | Buffer> = {
      "/Meta.json": JSON.stringify({
        meta: { date: "2026-11-15", version: "5.3.0+20261115" },
        data: { date, version },
      }),
      "/AllPrintings.sqlite.gz": gz,
      "/AllPrintings.sqlite.gz.sha256": sha(gz),
      "/AllPrintings.sqlite.sha256": sha(raw),
    };
    const out = body[path];
    if (out === undefined) res.writeHead(404).end("not found");
    else res.writeHead(200).end(out);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

export function testConfig(
  repo: string,
  mtgjsonUrl: string,
  extra: Record<string, string> = {},
): Config {
  setLogLevel("error");
  return parseConfig({
    DECK_REPO_URL: `file://${repo}`,
    ALLOW_INSECURE_TEST_REPO_URL: "1",
    DATA_DIR: tmp("app-data-"),
    MTGJSON_BASE_URL: mtgjsonUrl,
    TCG_GAUNTLET_MIN_CARDS: "100",
    PRESETS_DIR: presetsDir,
    LOG_LEVEL: "error",
    ...extra,
  });
}

// ------------------------------------------------------------------ fake clock

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** A clock whose time moves only when a test says so. */
export class FakeClock implements Clock {
  time = 1_800_000_000_000;
  private timers: Timer[] = [];
  private next = 1;
  /** `random()` returns this. 0.5 gives a jitter factor of exactly 1. */
  rand = 0.5;

  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const t = { id: this.next++, at: this.time + ms, fn };
    this.timers.push(t);
    return t.id;
  }
  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== h);
  }
  random(): number {
    return this.rand;
  }
  /** Times of the pending timers, relative to now. */
  pending(): number[] {
    return this.timers.map((t) => t.at - this.time).sort((a, b) => a - b);
  }
  /** Moves time forward and runs the timers that fall due, in order. */
  async advance(
    ms: number,
    settle: () => Promise<void> = async () => undefined,
  ): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.time = Math.max(this.time, due.at);
      due.fn();
      await settle();
    }
    this.time = end;
  }
}
