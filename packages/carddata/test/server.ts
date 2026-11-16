// A local stand-in for mtgjson.com/api/v5, over node:http.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type IncomingHttpHeaders, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { miniFixture } from "./helpers.js";

export interface Served {
  version: string;
  date: string;
  gz: Buffer;
  gzSha: string;
  rawSha: string;
  /** Replaces a response: path (for example `/Meta.json`) to status. */
  status: Map<string, number>;
  /** Replaces a body: path to bytes. */
  body: Map<string, string | Buffer>;
  /** Paths that never answer. */
  hang: Set<string>;
}

export interface TestServer {
  url: string;
  state: Served;
  requests: string[];
  headers: IncomingHttpHeaders[];
  close(): Promise<void>;
}

const sha = (b: Buffer | string): string =>
  createHash("sha256").update(b).digest("hex");

let cached: { raw: Buffer; gz: Buffer } | undefined;

/** The gzipped mini fixture, made once per test run. */
export function fixtureArchive(): { raw: Buffer; gz: Buffer } {
  if (cached === undefined) {
    const raw = readFileSync(miniFixture);
    cached = { raw, gz: gzipSync(raw, { level: 1 }) };
  }
  return cached;
}

export function newState(version: string, date: string): Served {
  const { raw, gz } = fixtureArchive();
  return {
    version,
    date,
    gz,
    gzSha: sha(gz),
    rawSha: sha(raw),
    status: new Map(),
    body: new Map(),
    hang: new Set(),
  };
}

export async function startServer(state: Served): Promise<TestServer> {
  const requests: string[] = [];
  const headers: IncomingHttpHeaders[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((req, res) => {
    const path = req.url ?? "";
    requests.push(path);
    headers.push(req.headers);
    if (state.hang.has(path)) return;
    const status = state.status.get(path);
    if (status !== undefined) {
      res.writeHead(status).end("no");
      return;
    }
    const override = state.body.get(path);
    let out: string | Buffer | undefined = override;
    if (out === undefined) {
      switch (path) {
        case "/Meta.json":
          out = JSON.stringify({
            meta: { date: "2026-11-15", version: "5.3.0+20261115" },
            data: { date: state.date, version: state.version },
          });
          break;
        case "/AllPrintings.sqlite.gz":
          out = state.gz;
          break;
        case "/AllPrintings.sqlite.gz.sha256":
          out = state.gzSha;
          break;
        case "/AllPrintings.sqlite.sha256":
          out = state.rawSha;
          break;
      }
    }
    if (out === undefined) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200).end(out);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    requests,
    headers,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
