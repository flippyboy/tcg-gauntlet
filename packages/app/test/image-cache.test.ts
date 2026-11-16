import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readdirSync, statSync, utimesSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageCache, ImageError } from "../src/lib/server/image-cache.js";
import { RateLimiter } from "../src/lib/server/rate-limit.js";
import { tmp } from "./helpers.js";

const id = (n: number): string =>
  `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

let url: string;
const paths: string[] = [];
const userAgents: string[] = [];
let inflight = 0;
let peak = 0;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer((req, res) => {
    paths.push(req.url ?? "");
    userAgents.push(req.headers["user-agent"] ?? "");
    if (req.url?.includes("redirect")) {
      res.writeHead(302, { Location: "/elsewhere" }).end();
      return;
    }
    if (req.url?.includes("00000dea")) {
      res.writeHead(404).end();
      return;
    }
    if (req.url?.includes("00000bad")) {
      res.writeHead(500).end();
      return;
    }
    inflight++;
    peak = Math.max(peak, inflight);
    setTimeout(() => {
      inflight--;
      res
        .writeHead(200, { "Content-Type": "image/jpeg" })
        .end(Buffer.alloc(1000, 7));
    }, 40);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("image cache", () => {
  it("fetches the large JPEG once and then serves it from disk", async () => {
    const c = new ImageCache({ dir: tmp(), maxBytes: 1e6, upstream: url });
    const a = id(0x1a);
    const p1 = await c.get(a, "front");
    expect(p1.endsWith(`/front/0/${a}.jpg`)).toBe(true);
    expect(paths.at(-1)).toBe(`/large/front/0/0/${a}.jpg`);
    expect(userAgents.at(-1)).toMatch(/^tcg-gauntlet\//);
    const n = paths.length;
    await c.get(a, "front");
    expect(paths.length).toBe(n);
    await c.get(a, "back");
    expect(paths.at(-1)).toBe(`/large/back/0/0/${a}.jpg`);
  });

  it("shares one fetch between concurrent requests for the same image", async () => {
    const c = new ImageCache({ dir: tmp(), maxBytes: 1e6, upstream: url });
    const n = paths.length;
    await Promise.all([c.get(id(0x2a), "front"), c.get(id(0x2a), "front")]);
    expect(paths.length - n).toBe(1);
  });

  it("runs at most 4 fetches at once", async () => {
    const c = new ImageCache({ dir: tmp(), maxBytes: 1e9, upstream: url });
    peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => c.get(id(0x100 + i), "front")),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(c.peak).toBeLessThanOrEqual(4);
  });

  it("does not follow redirects", async () => {
    const c = new ImageCache({
      dir: tmp(),
      maxBytes: 1e6,
      upstream: url,
      fetchFn: (u, init) => fetch(`${u as string}?redirect`, init),
    });
    await expect(c.get(id(0x3a), "front")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("maps upstream errors", async () => {
    const c = new ImageCache({ dir: tmp(), maxBytes: 1e6, upstream: url });
    await expect(c.get(id(0xdea), "front")).rejects.toMatchObject({
      status: 404,
    });
    await expect(c.get(id(0xbad), "front")).rejects.toMatchObject({
      status: 502,
    });
    await expect(c.get("../../etc/passwd", "front")).rejects.toBeInstanceOf(
      ImageError,
    );
    const down = new ImageCache({
      dir: tmp(),
      maxBytes: 1e6,
      upstream: "http://127.0.0.1:1",
    });
    await expect(down.get(id(1), "front")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("touches a hit and evicts the oldest files past the limit", async () => {
    const dir = tmp();
    const c = new ImageCache({ dir, maxBytes: 2500, upstream: url });
    const [a, b, d] = [id(0x41), id(0x42), id(0x43)];
    const pa = await c.get(a, "front");
    const pb = await c.get(b, "front");
    // a is the oldest, then b. A hit on a makes b the oldest.
    utimesSync(pa, new Date(1000), new Date(1000));
    utimesSync(pb, new Date(2000), new Date(2000));
    await c.get(a, "front");
    expect(statSync(pa).mtimeMs).toBeGreaterThan(Date.now() - 60000);
    await c.get(d, "front");
    expect(existsSync(pb)).toBe(false);
    expect(existsSync(pa)).toBe(true);
    expect(
      readdirSync(`${dir}/front/0`).filter((n) => n.endsWith(".jpg")).length,
    ).toBe(2);
  });
});

describe("rate limit", () => {
  it("allows 120 requests a minute per client, then refills", () => {
    let t = 0;
    const l = new RateLimiter(120, () => t);
    for (let i = 0; i < 120; i++) expect(l.take("1.1.1.1")).toBe(true);
    expect(l.take("1.1.1.1")).toBe(false);
    expect(l.take("2.2.2.2")).toBe(true);
    t += 500; // one token every 500 ms
    expect(l.take("1.1.1.1")).toBe(true);
    expect(l.take("1.1.1.1")).toBe(false);
    t += 10 * 60_000;
    for (let i = 0; i < 120; i++) l.take(`x${i}`);
    expect(l.take("1.1.1.1")).toBe(true);
  });
});
