// A local stand-in for mtgjson.com/api/v5, over node:http. It serves the mini
// fixture, gzipped, with the checksum files and a Meta.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import { gzipSync } from "node:zlib";
import { fixturesDir } from "./helpers.js";

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export interface TestServer {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

let cached: { raw: Buffer; gz: Buffer } | undefined;

export async function startServer(
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
