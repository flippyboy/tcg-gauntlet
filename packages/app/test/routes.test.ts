import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConfig, setConfig } from "../src/lib/server/config.js";
import { setImageServices } from "../src/lib/server/app-state.js";
import { ImageCache } from "../src/lib/server/image-cache.js";
import { RateLimiter } from "../src/lib/server/rate-limit.js";
import { getSnapshot, setSnapshot } from "../src/lib/server/snapshot.js";
import { resetStatus } from "../src/lib/server/status.js";
import { startSync, stopSync } from "../src/lib/server/sync.js";
import { resetWebhookThrottle } from "../src/lib/server/webhook.js";
import { handle } from "../src/hooks.server.js";
import { load as layoutLoad } from "../src/routes/+layout.server.js";
import { load as indexLoad } from "../src/routes/+page.server.js";
import { load as gauntletLoad } from "../src/routes/g/[gauntlet]/+page.server.js";
import { load as deckLoad } from "../src/routes/g/[gauntlet]/[deck]/+page.server.js";
import { load as historyLoad } from "../src/routes/g/[gauntlet]/[deck]/history/+page.server.js";
import { load as versionLoad } from "../src/routes/g/[gauntlet]/[deck]/v/[commit]/+page.server.js";
import { load as mtgaLoad } from "../src/routes/g/[gauntlet]/[deck]/export/mtga/+page.server.js";
import { load as proxiesLoad } from "../src/routes/g/[gauntlet]/[deck]/proxies/+page.server.js";
import { GET as exportGet } from "../src/routes/g/[gauntlet]/[deck]/export/[kind]/+server.js";
import { GET as imgGet } from "../src/routes/img/[id]/[face]/+server.js";
import { POST as webhookPost } from "../src/routes/webhook/github/+server.js";
import { GET as healthz } from "../src/routes/healthz/+server.js";
import { GET as readyz } from "../src/routes/readyz/+server.js";
import { GET as statusGet } from "../src/routes/status/+server.js";
import {
  type TestServer,
  commit,
  git,
  goodFiles,
  makeRepo,
  startMtgjson,
  tmp,
  testConfig,
} from "./helpers.js";

// The route functions take SvelteKit's event. The tests pass the few fields they read.
const ev = (o: Record<string, unknown>): never => o as never;
const P = { gauntlet: "g", deck: "burn" };

/** The HTTP status of a thrown SvelteKit error or redirect. */
async function statusOf(fn: () => unknown): Promise<number> {
  try {
    await fn();
  } catch (e) {
    return (e as { status: number }).status;
  }
  return 200;
}

let mtgjson: TestServer;
let repo: string;
let upstream: ReturnType<typeof createServer>;
let upstreamUrl: string;
const SECRET = "hook-secret";

beforeAll(async () => {
  mtgjson = await startMtgjson();
  upstream = createServer((_req, res) => {
    res
      .writeHead(200, { "Content-Type": "image/jpeg" })
      .end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  repo = makeRepo({
    ...goodFiles(),
    "g/späce deck.txt": "4 Lightning Bolt\n",
    "bad/gauntlet.yaml":
      "schema_version: 1\nname: Bad\nformat: preset:nope@1\n",
    "bad/x.txt": "4 Char\n",
  });
  setConfig(
    testConfig(repo, mtgjson.url, {
      WEBHOOK_SECRET: SECRET,
      PUBLIC_BASE_URL: "https://decks.example.com",
    }),
  );
});
afterAll(async () => {
  await stopSync();
  upstream.closeAllConnections();
  upstream.close();
  await mtgjson.close();
  setConfig(undefined);
});

describe("before the first snapshot", () => {
  it("answers 503 on every route except healthz, readyz and status", async () => {
    setSnapshot(null);
    resetStatus();
    expect(await statusOf(() => layoutLoad(ev({})))).toBe(503);
    expect(await statusOf(() => indexLoad(ev({})))).toBe(503);
    expect(await statusOf(() => gauntletLoad(ev({ params: P })))).toBe(503);
    expect(await statusOf(() => deckLoad(ev({ params: P })))).toBe(503);
    expect(
      await statusOf(() => exportGet(ev({ params: { ...P, kind: "mtgo" } }))),
    ).toBe(503);
    expect(
      await statusOf(() => imgGet(ev({ params: { id: "x", face: "front" } }))),
    ).toBe(503);
    expect(
      await statusOf(() =>
        webhookPost(
          ev({ request: new Request("http://x", { method: "POST" }) }),
        ),
      ),
    ).toBe(503);

    expect((await healthz(ev({}))).status).toBe(200);
    expect((await readyz(ev({}))).status).toBe(503);
    const st = (await (await statusGet(ev({}))).json()) as Record<
      string,
      unknown
    >;
    expect(st["ready"]).toBe(false);
    expect(st["webhook_url"]).toBe("https://decks.example.com/webhook/github");
  });
});

describe("with a snapshot", () => {
  beforeAll(async () => {
    const loop = startSync(getConfig());
    await loop.idle();
    expect(getSnapshot()).not.toBeNull();
    setImageServices(
      new ImageCache({
        dir: tmp("img-"),
        maxBytes: 1e6,
        upstream: upstreamUrl,
      }),
      new RateLimiter(3),
    );
  });

  it("serves healthz, readyz and status", async () => {
    expect((await readyz(ev({}))).status).toBe(200);
    const st = (await (await statusGet(ev({}))).json()) as Record<
      string,
      unknown
    >;
    expect(st).toMatchObject({
      ready: true,
      consecutive_failures: 0,
      stale_since: null,
      history: "ready",
    });
    expect(st["disk_free_bytes"]).toEqual(expect.any(Number));
    expect(st["card_data"]).toMatchObject({ version: "5.3.0+20261115" });
    expect(st["lastSync"]).toMatchObject({
      commit: git(repo, ["rev-parse", "HEAD"]),
    });
  });

  it("lists gauntlets with their deck counts", () => {
    const d = indexLoad(ev({})) as {
      gauntlets: { folder: string; deckCount: number; invalidCount: number }[];
    };
    expect(d.gauntlets.map((g) => [g.folder, g.deckCount])).toEqual([
      ["bad", 1],
      ["g", 2],
    ]);
    const bad = d.gauntlets.find((g) => g.folder === "bad");
    expect(bad?.invalidCount).toBe(1);
  });

  it("builds the layout footer", () => {
    const d = layoutLoad(ev({})) as {
      footer: Record<string, string>;
      staleSince: string | null;
    };
    expect(d.footer["commit"]).toBe(git(repo, ["rev-parse", "HEAD"]));
    expect(d.footer["commitUrl"]).toContain("/commit/");
    expect(d.footer["mtgjsonVersion"]).toBe("5.3.0+20261115");
    expect(d.footer["engineVersion"]).toBeTruthy();
    expect(d.staleSince).toBeNull();
  });

  it("shows a gauntlet, and 404s an unknown one", () => {
    const d = gauntletLoad(ev({ params: { gauntlet: "g" } })) as {
      decks: { name: string }[];
      descriptionHtml: string;
      newDeckUrl: string;
    };
    expect(d.decks.map((x) => x.name)).toEqual(["burn", "späce deck"]);
    expect(d.descriptionHtml).toContain("A test gauntlet");
    expect(d.newDeckUrl).toMatch(/\/new\/main\/g$/);
    const bad = gauntletLoad(ev({ params: { gauntlet: "bad" } })) as {
      errors: { code: string }[];
    };
    expect(bad.errors.map((e) => e.code)).toContain("E-FORMAT-UNKNOWN");
    expect(() => gauntletLoad(ev({ params: { gauntlet: "nope" } }))).toThrow();
  });

  it("shows a deck with cards, metadata, primer, legality and links", async () => {
    const d = deckLoad(ev({ params: P })) as Record<string, any>;
    expect(d["legality"]).toMatchObject({
      valid: true,
      mtgjsonVersion: "5.3.0+20261115",
    });
    expect(d["groups"].main.length).toBeGreaterThan(0);
    expect(d["groups"].main[0].cards[0].small).toMatch(
      /^https:\/\/cards\.scryfall\.io\/small\/front\//,
    );
    expect(d["primerHtml"]).toContain("&lt;script&gt;");
    expect(d["primerHtml"]).not.toContain("<script>");
    expect(d["links"].edit).toMatch(/\/edit\/main\/g\/burn\.txt$/);
    expect(d["links"].mtgo).toBe("/g/g/burn/export/mtgo");
    expect(d["mainCount"]).toBeGreaterThan(0);
    expect(
      await statusOf(() =>
        deckLoad(ev({ params: { gauntlet: "g", deck: "nope" } })),
      ),
    ).toBe(404);
    expect(
      await statusOf(() =>
        deckLoad(ev({ params: { gauntlet: "x", deck: "burn" } })),
      ),
    ).toBe(404);
  });

  it("exports MTGO and .dec with RFC 6266 headers, and 404s other kinds", async () => {
    const mtgo = await exportGet(ev({ params: { ...P, kind: "mtgo" } }));
    expect(mtgo.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(mtgo.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''burn.txt",
    );
    expect(await mtgo.text()).toMatch(/^4 .+\r\n/);
    const dec = await exportGet(ev({ params: { ...P, kind: "dec" } }));
    expect(dec.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''burn.dec",
    );
    expect(await dec.text()).toContain("// NAME : ");
    const uni = await exportGet(
      ev({ params: { gauntlet: "g", deck: "späce deck", kind: "mtgo" } }),
    );
    expect(uni.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''sp%C3%A4ce%20deck.txt",
    );
    expect(
      await statusOf(() => exportGet(ev({ params: { ...P, kind: "pdf" } }))),
    ).toBe(404);
    expect(
      await statusOf(() => exportGet(ev({ params: { ...P, kind: "mtga" } }))),
    ).toBe(404);
  });

  it("shows the MTGA text and the proxies stub data", () => {
    const m = mtgaLoad(ev({ params: P })) as {
      text: string;
      unavailable: string[];
    };
    expect(m.text).toMatch(/^\d+ /);
    expect(Array.isArray(m.unavailable)).toBe(true);
    const p = proxiesLoad(ev({ params: P })) as {
      cards: { scryfallId: string }[];
    };
    expect(p.cards.length).toBeGreaterThan(0);
  });

  it("lists versions and shows one, with a diff and raw text for unparseable ones", async () => {
    const h = historyLoad(ev({ params: P })) as {
      versions: { commit: string; short: string }[];
    };
    expect(h.versions).toHaveLength(1);
    const first = h.versions[0]?.commit as string;

    const v = (await versionLoad(
      ev({ params: { ...P, commit: first }, url: new URL("http://x/v") }),
    )) as Record<string, any>;
    expect(v["groups"].main.length).toBeGreaterThan(0);
    expect(v["primerHtml"]).toContain("Burn");
    expect(v["diff"]).toBeNull();
    const short = (await versionLoad(
      ev({
        params: { ...P, commit: first.slice(0, 7) },
        url: new URL("http://x/v"),
      }),
    )) as Record<string, any>;
    expect(short["version"].commit).toBe(first);

    expect(
      await statusOf(() =>
        versionLoad(
          ev({
            params: { ...P, commit: "abcdef0" },
            url: new URL("http://x/v"),
          }),
        ),
      ),
    ).toBe(404);
    expect(
      await statusOf(() =>
        versionLoad(
          ev({ params: { ...P, commit: "zz" }, url: new URL("http://x/v") }),
        ),
      ),
    ).toBe(404);
    expect(
      await statusOf(() =>
        versionLoad(
          ev({
            params: { ...P, commit: first.slice(0, 6) },
            url: new URL("http://x/v"),
          }),
        ),
      ),
    ).toBe(404);

    // Two more versions: an edit, then a version that does not parse.
    commit(repo, { "g/burn.txt": "4 Lightning Bolt\n" }, "shrink");
    commit(
      repo,
      { "g/burn.txt": "---\nschema_version: 99\n---\n4 Char\n" },
      "bad schema",
    );
    const { triggerSync, getHistory } =
      await import("../src/lib/server/sync.js");
    triggerSync("webhook");
    await new Promise((r) => setTimeout(r, 50));
    for (
      let i = 0;
      i < 100 && getSnapshot()?.commit !== git(repo, ["rev-parse", "HEAD"]);
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    const h2 = historyLoad(ev({ params: P })) as {
      versions: { commit: string; subject: string }[];
    };
    expect(h2.versions.map((x) => x.subject)).toEqual([
      "bad schema",
      "shrink",
      "initial",
    ]);
    const [bad, shrink, init] = h2.versions.map((x) => x.commit) as [
      string,
      string,
      string,
    ];

    const diff = (await versionLoad(
      ev({
        params: { ...P, commit: shrink },
        url: new URL(`http://x/v?compare=${init}`),
      }),
    )) as Record<string, any>;
    expect(diff["diff"].unavailable).toBe(false);
    expect(
      diff["diff"].entries.some((e: { kind: string }) => e.kind === "removed"),
    ).toBe(true);
    const raw = (await versionLoad(
      ev({
        params: { ...P, commit: bad },
        url: new URL(`http://x/v?compare=${shrink}`),
      }),
    )) as Record<string, any>;
    expect(raw["groups"]).toBeNull();
    expect(raw["raw"]).toContain("schema_version: 99");
    expect(raw["notice"]).toMatch(/no longer parses/);
    expect(raw["diff"].unavailable).toBe(true);
    expect(
      await statusOf(() =>
        versionLoad(
          ev({
            params: { ...P, commit: shrink },
            url: new URL("http://x/v?compare=ffffff0"),
          }),
        ),
      ),
    ).toBe(404);
    expect(getHistory()).not.toBeNull();
  });

  it("serves images from the allow-list, with the face rules and the rate limit", async () => {
    const snap = getSnapshot();
    const [one, two] = [...(snap?.allowedImages.keys() ?? [])] as [
      string,
      string,
    ];
    // Replace the allow-list for this test: one single-faced and one double-faced card.
    const single = "11111111-1111-4111-8111-111111111111";
    const dfc = "22222222-2222-4222-8222-222222222222";
    setSnapshot({
      ...(snap as NonNullable<typeof snap>),
      allowedImages: new Map([
        [single, { hasBackFace: false }],
        [dfc, { hasBackFace: true }],
      ]),
    });
    setImageServices(
      new ImageCache({
        dir: tmp("img-"),
        maxBytes: 1e6,
        upstream: upstreamUrl,
      }),
      new RateLimiter(3),
    );
    const call = (id: string, face: string): Promise<Response> =>
      imgGet(
        ev({ params: { id, face }, getClientAddress: () => "9.9.9.9" }),
      ) as Promise<Response>;

    expect(
      await statusOf(() =>
        call("33333333-3333-4333-8333-333333333333", "front"),
      ),
    ).toBe(404);
    expect(one).not.toBe(two);
    expect(await statusOf(() => call(single, "side"))).toBe(404);
    expect(await statusOf(() => call(single, "back"))).toBe(404);
    const ok = await call(dfc, "back");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(ok.headers.get("Cache-Control")).toBe("public, max-age=604800");
    expect((await ok.arrayBuffer()).byteLength).toBe(4);
    expect((await call(single, "front")).status).toBe(200);
    expect((await call(single, "front")).status).toBe(200);
    const limited = await call(single, "front");
    expect(limited.status).toBe(429);
    // The 404s did not use up tokens of another client.
    expect(
      (
        await imgGet(
          ev({
            params: { id: single, face: "front" },
            getClientAddress: () => "8.8.8.8",
          }),
        )
      ).status,
    ).toBe(200);
    setSnapshot(snap);
  });

  it("maps upstream failures of the image route to 502", async () => {
    const snap = getSnapshot() as NonNullable<ReturnType<typeof getSnapshot>>;
    const id = "44444444-4444-4444-8444-444444444444";
    setSnapshot({
      ...snap,
      allowedImages: new Map([[id, { hasBackFace: false }]]),
    });
    setImageServices(
      new ImageCache({
        dir: tmp("img-"),
        maxBytes: 1e6,
        upstream: "http://127.0.0.1:1",
      }),
      new RateLimiter(100),
    );
    expect(
      await statusOf(() =>
        imgGet(
          ev({
            params: { id, face: "front" },
            getClientAddress: () => "1.1.1.1",
          }),
        ),
      ),
    ).toBe(502);
    setSnapshot(snap);
  });

  it("takes webhooks", async () => {
    resetWebhookThrottle();
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
    const mk = (s: string): Request =>
      new Request("http://x/webhook/github", {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": s, "x-github-event": "push" },
      });
    expect((await webhookPost(ev({ request: mk("sha256=00") }))).status).toBe(
      401,
    );
    expect((await webhookPost(ev({ request: mk(sig) }))).status).toBe(202);
    expect((await webhookPost(ev({ request: mk(sig) }))).status).toBe(429);
  });

  it("the handle hook adds the security headers", async () => {
    const res = await handle({
      event: ev({
        request: new Request("http://x/"),
        url: new URL("http://x/"),
      }),
      resolve: () => Promise.resolve(new Response("ok")),
    });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });
});
