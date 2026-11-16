// Test support for the end-to-end suite. Test only: nothing here ships in the image.
//
//   * a deck repo: `fixture-repo/` copied into a fresh git repository on `main`,
//   * a static server that answers like mtgjson.com/api/v5, from the mini fixture
//     (gzip, .sha256 files and Meta.json),
//   * an image stub that answers every `cards.scryfall.io`-shaped path with one JPEG.
//     The app reaches it through `TCG_GAUNTLET_IMAGE_UPSTREAM`, which is accepted only
//     together with `ALLOW_INSECURE_TEST_REPO_URL`.
//
// As a script it starts the three and stays up (the CI job uses it with the image):
//   node e2e/fixtures.ts --dir <empty dir> --host 0.0.0.0 --mtgjson-port 8801 --images-port 8802
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = fileURLToPath(new URL(".", import.meta.url));
export const appDir = join(here, "..");
export const repoRoot = join(here, "..", "..", "..");
export const WEBHOOK_SECRET = "e2e-webhook-secret";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "E2E Author",
      GIT_AUTHOR_EMAIL: "e2e@example.com",
      GIT_COMMITTER_NAME: "E2E Author",
      GIT_COMMITTER_EMAIL: "e2e@example.com",
    },
  }).trim();
}

/** A new git repository at `dir` holding the files of `fixture-repo/`. */
export function makeDeckRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  cpSync(join(here, "fixture-repo"), dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, [
    "commit",
    "-q",
    "--no-gpg-sign",
    "-m",
    "Add the fixture gauntlets",
  ]);
  return dir;
}

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

/** The mini MTGJSON fixture, served the way mtgjson.com serves AllPrintings. */
export async function startMtgjson(
  host: string,
  port: number,
): Promise<{ server: Server; port: number }> {
  const raw = readFileSync(
    join(repoRoot, "conformance", "fixtures", "mini-allprintings.sqlite"),
  );
  const gz = gzipSync(raw, { level: 1 });
  const body: Record<string, string | Buffer> = {
    "/Meta.json": JSON.stringify({
      meta: { date: "2026-11-15", version: "5.3.0+20261115" },
      data: { date: "2026-11-15", version: "5.3.0+20261115" },
    }),
    "/AllPrintings.sqlite.gz": gz,
    "/AllPrintings.sqlite.gz.sha256": sha(gz),
    "/AllPrintings.sqlite.sha256": sha(raw),
  };
  const server = createServer((req, res) => {
    const out = body[req.url ?? ""];
    if (out === undefined) res.writeHead(404).end("not found");
    else res.writeHead(200).end(out);
  });
  return { server, port: await listen(server, host, port) };
}

/** Every path answers with the same card-shaped JPEG (672x936). */
export async function startImageStub(
  host: string,
  port: number,
): Promise<{ server: Server; port: number }> {
  const jpeg = readFileSync(join(here, "stub-card.jpg"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "image/jpeg" }).end(jpeg);
  });
  return { server, port: await listen(server, host, port) };
}

export interface Fixtures {
  repoDir: string;
  mtgjsonPort: number;
  imagesPort: number;
  close(): Promise<void>;
}

export async function startFixtures(opts: {
  dir: string;
  host?: string;
  mtgjsonPort?: number;
  imagesPort?: number;
}): Promise<Fixtures> {
  const host = opts.host ?? "127.0.0.1";
  const repoDir = makeDeckRepo(join(opts.dir, "deck-repo"));
  const m = await startMtgjson(host, opts.mtgjsonPort ?? 0);
  const i = await startImageStub(host, opts.imagesPort ?? 0);
  return {
    repoDir,
    mtgjsonPort: m.port,
    imagesPort: i.port,
    close: async () => {
      for (const s of [m.server, i.server]) {
        s.closeAllConnections();
        await new Promise<void>((r) => s.close(() => r()));
      }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      "mtgjson-port": { type: "string", default: "0" },
      "images-port": { type: "string", default: "0" },
    },
  });
  if (values.dir === undefined) {
    console.error("Usage: node e2e/fixtures.ts --dir <empty dir> [--host H]");
    process.exit(2);
  }
  const f = await startFixtures({
    dir: values.dir,
    host: values.host,
    mtgjsonPort: Number(values["mtgjson-port"]),
    imagesPort: Number(values["images-port"]),
  });
  console.log(
    JSON.stringify({
      repoDir: f.repoDir,
      mtgjsonPort: f.mtgjsonPort,
      imagesPort: f.imagesPort,
    }),
  );
  const stop = (): void => {
    void f.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
