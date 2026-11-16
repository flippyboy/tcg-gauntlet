// Runs the Playwright smoke suite (item 73). Three ways to get an app to test:
//
//   node e2e/run.ts              starts the fixtures and the built app
//                                (`node build/index.js` in packages/app, or in
//                                E2E_APP_DIR, for example a `pnpm deploy` folder)
//   E2E_BASE_URL=http://...      tests an app that is already running, such as the
//                                Docker image in CI. The caller has started
//                                `e2e/fixtures.ts` and set E2E_REPO_DIR (its deck repo)
//   --no-browser                 skips the tests tagged @browser (HTTP checks only)
//
// Other arguments go to `playwright test`. Environment: E2E_CHROMIUM_PATH is a
// Chromium or Chrome binary to use instead of Playwright's own download.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDir, repoRoot, startFixtures, WEBHOOK_SECRET } from "./fixtures.ts";

const args = process.argv.slice(2);
const noBrowser = args.includes("--no-browser");
const passThrough = args.filter((a) => a !== "--no-browser");
const playwrightArgs = [
  "playwright",
  "test",
  ...(noBrowser ? ["--grep-invert", "@browser"] : []),
  ...passThrough,
];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function runPlaywright(env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("npx", playwrightArgs, {
      cwd: appDir,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForHealth(base: string, app: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error("The app exited early");
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${base}/healthz did not answer within 30 s`);
}

async function main(): Promise<number> {
  const external = process.env["E2E_BASE_URL"];
  if (external !== undefined) {
    const repo = process.env["E2E_REPO_DIR"];
    if (repo === undefined) {
      console.error(
        "E2E_BASE_URL needs E2E_REPO_DIR (the deck repo it serves)",
      );
      return 2;
    }
    return runPlaywright({
      E2E_BASE_URL: external,
      E2E_REPO_DIR: repo,
      E2E_WEBHOOK_SECRET: process.env["E2E_WEBHOOK_SECRET"] ?? WEBHOOK_SECRET,
    });
  }

  const tmp = mkdtempSync(join(tmpdir(), "tcg-e2e-"));
  const fixtures = await startFixtures({ dir: tmp });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dir = process.env["E2E_APP_DIR"] ?? appDir;
  const app = spawn("node", ["build/index.js"], {
    cwd: dir,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      PATH: process.env["PATH"] ?? "",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: join(tmp, "data"),
      DECK_REPO_URL: `file://${fixtures.repoDir}`,
      ALLOW_INSECURE_TEST_REPO_URL: "1",
      MTGJSON_BASE_URL: `http://127.0.0.1:${fixtures.mtgjsonPort}`,
      TCG_GAUNTLET_IMAGE_UPSTREAM: `http://127.0.0.1:${fixtures.imagesPort}`,
      TCG_GAUNTLET_MIN_CARDS: "100",
      WEBHOOK_SECRET,
      PRESETS_DIR: join(repoRoot, "presets"),
      LOG_LEVEL: "warn",
    },
  });
  try {
    await waitForHealth(base, app);
    return await runPlaywright({
      E2E_BASE_URL: base,
      E2E_REPO_DIR: fixtures.repoDir,
      E2E_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
  } finally {
    app.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await fixtures.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

process.exit(await main());
