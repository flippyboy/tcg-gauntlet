import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Git } from "@tcg-gauntlet/repo";
import {
  type CardDataLayer,
  SyncLoop,
  backoffMs,
  defaultCardData,
} from "../src/lib/server/sync.js";
import { History } from "../src/lib/server/history.js";
import { getSnapshot, setSnapshot } from "../src/lib/server/snapshot.js";
import {
  getStatusState,
  isStale,
  resetStatus,
} from "../src/lib/server/status.js";
import {
  FakeClock,
  type TestServer,
  commit,
  git,
  goodFiles,
  makeRepo,
  startMtgjson,
  testConfig,
} from "./helpers.js";

let mtgjson: TestServer;
beforeAll(async () => {
  mtgjson = await startMtgjson();
});
afterAll(async () => {
  await mtgjson.close();
});
beforeEach(() => {
  setSnapshot(null);
  resetStatus();
});

class FlakyGit extends Git {
  failFetch: Error | null = null;
  healthy = true;
  throttle = false;
  gate: Promise<void> | null = null;
  fetches = 0;
  clones = 0;
  override async fetch(dir: string, branch: string): Promise<void> {
    this.fetches++;
    if (this.gate !== null) await this.gate;
    if (this.failFetch !== null) throw this.failFetch;
    return super.fetch(dir, branch);
  }
  override async clone(
    url: string,
    dir: string,
    branch?: string,
  ): Promise<void> {
    this.clones++;
    return super.clone(url, dir, branch);
  }
  override async isRepoHealthy(): Promise<boolean> {
    return this.healthy;
  }
  override async lsRemote(
    dir: string,
    branch: string,
  ): Promise<{ sha: string } | { error: string; throttled: boolean }> {
    if (this.throttle) return { error: "HTTP 429", throttled: true };
    return super.lsRemote(dir, branch);
  }
}

interface Harness {
  repo: string;
  clock: FakeClock;
  git: FlakyGit;
  loop: SyncLoop;
  history: History;
  head(): string;
  settle(): Promise<void>;
}

function harness(
  files = goodFiles(),
  over: {
    cardData?: (real: CardDataLayer) => CardDataLayer;
    extra?: Record<string, string>;
  } = {},
): Harness {
  const repo = makeRepo(files);
  const config = testConfig(repo, mtgjson.url, over.extra);
  const g = new FlakyGit({ dataDir: config.dataDir, testMode: true });
  const history = new History(
    g,
    join(config.dataDir, "history.sqlite"),
    config.repoDir,
  );
  history.open();
  const clock = new FakeClock();
  const real = defaultCardData(config);
  const loop = new SyncLoop({
    config,
    git: g,
    history,
    cardData: over.cardData?.(real) ?? real,
    clock,
  });
  return {
    repo,
    clock,
    git: g,
    loop,
    history,
    head: () => git(repo, ["rev-parse", "HEAD"]),
    settle: () => loop.idle(),
  };
}

describe("sync loop", () => {
  it("cold start: clones, refreshes card data and builds the first snapshot", async () => {
    const h = harness();
    expect(getSnapshot()).toBeNull();
    await h.loop.start();
    const snap = getSnapshot();
    expect(snap?.commit).toBe(h.head());
    expect(snap?.gauntlets.map((g) => g.folder)).toEqual(["g"]);
    expect(snap?.gauntlets[0]?.decks[0]?.valid).toBe(true);
    expect(snap?.gauntlets[0]?.decks[0]?.primerHtml).not.toContain("<script>");
    expect(snap?.mtgjson.version).toBe("5.3.0+20261115");
    expect(snap?.allowedImages.size).toBeGreaterThan(0);
    const st = getStatusState();
    expect(st).toMatchObject({
      consecutiveFailures: 0,
      staleSince: null,
      history: "ready",
      cardDataReady: true,
    });
    expect(st.lastSync).toMatchObject({ commit: h.head(), error: null });
    expect(st.cardData.version).toBe("5.3.0+20261115");
    expect(st.formats).toHaveLength(1);
    expect(h.git.clones).toBe(1);
    expect(existsSync(join(h.loop.history.dbPath))).toBe(true);
    await h.loop.stop();
  });

  it("polls: an unchanged remote keeps the snapshot, a new commit replaces it", async () => {
    const h = harness();
    await h.loop.start();
    const first = getSnapshot();
    // The poll interval is 30 s with a jitter of +-10 percent. rand 0.5 gives 30 s.
    expect(h.clock.pending()).toContain(30_000);
    await h.clock.advance(30_000, h.settle);
    expect(getSnapshot()).toBe(first);
    expect(h.git.fetches).toBe(0);

    commit(h.repo, { "g/second.txt": "4 Lightning Bolt\n" }, "add second");
    await h.clock.advance(30_000, h.settle);
    const next = getSnapshot();
    expect(next).not.toBe(first);
    expect(next?.commit).toBe(h.head());
    expect(next?.gauntlets[0]?.decks.map((d) => d.name)).toEqual([
      "burn",
      "second",
    ]);
    expect(h.history.versions("g/second", 5)).toHaveLength(1);
    await h.loop.stop();
  });

  it("applies jitter to the poll interval", async () => {
    const h = harness();
    h.clock.rand = 0;
    await h.loop.start();
    expect(h.clock.pending()).toContain(27_000);
    await h.loop.stop();
  });

  it("a failed fetch keeps the snapshot and backs off 30 s, 60 s, 120 s", async () => {
    const h = harness();
    await h.loop.start();
    const first = getSnapshot();
    commit(h.repo, { "g/second.txt": "4 Char\n" }, "add second");
    h.git.failFetch = new Error("network down");

    await h.clock.advance(30_000, h.settle);
    expect(getSnapshot()).toBe(first);
    let st = getStatusState();
    expect(st.consecutiveFailures).toBe(1);
    expect(st.staleSince).not.toBeNull();
    const since = st.staleSince;
    expect(st.lastSync.error).toContain("network down");
    expect(isStale()).toBe(false);
    expect(h.clock.pending()).toContain(30_000);

    await h.clock.advance(29_999, h.settle);
    expect(getStatusState().consecutiveFailures).toBe(1);
    await h.clock.advance(1, h.settle);
    st = getStatusState();
    expect(st.consecutiveFailures).toBe(2);
    expect(st.staleSince).toBe(since);
    expect(h.clock.pending()).toContain(60_000);
    expect(isStale()).toBe(false);

    await h.clock.advance(60_000, h.settle);
    expect(getStatusState().consecutiveFailures).toBe(3);
    expect(isStale()).toBe(true);
    expect(h.clock.pending()).toContain(120_000);
    // The snapshot is still the old one, and the app still serves it.
    expect(getSnapshot()).toBe(first);

    // The next success resets the delay and the banner.
    h.git.failFetch = null;
    await h.clock.advance(120_000, h.settle);
    st = getStatusState();
    expect(st).toMatchObject({ consecutiveFailures: 0, staleSince: null });
    expect(isStale()).toBe(false);
    expect(getSnapshot()?.commit).toBe(h.head());
    expect(h.clock.pending()).toContain(30_000);
    await h.loop.stop();
  });

  it("caps the backoff at 10 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000,
    ]);
  });

  it("a throttled ls-remote counts as a failure and backs off", async () => {
    const h = harness();
    await h.loop.start();
    h.git.throttle = true;
    await h.clock.advance(30_000, h.settle);
    const st = getStatusState();
    expect(st.consecutiveFailures).toBe(1);
    expect(st.lastSync.error).toContain("throttled");
    expect(h.clock.pending()).toContain(30_000);
    await h.loop.stop();
  });

  it("deletes a damaged clone and clones again", async () => {
    const h = harness();
    await h.loop.start();
    commit(h.repo, { "g/second.txt": "4 Char\n" }, "add second");
    h.git.failFetch = new Error("fatal: bad object");
    h.git.healthy = false;
    const r = h.loop.trigger("webhook");
    await r;
    // The re-clone replaced the clone, so the new commit is in.
    expect(h.git.clones).toBe(2);
    expect(getSnapshot()?.commit).toBe(h.head());
    expect(getStatusState().consecutiveFailures).toBe(0);
    await h.loop.stop();
  });

  it("keeps a healthy clone when the fetch fails", async () => {
    const h = harness();
    await h.loop.start();
    h.git.failFetch = new Error("timeout");
    await h.loop.trigger("webhook");
    expect(h.git.clones).toBe(1);
    expect(getStatusState().consecutiveFailures).toBe(1);
    await h.loop.stop();
  });

  it("builds a new format before the swap", async () => {
    const h = harness();
    let registered: string[] = [];
    let commitAtRegister: string[] = [];
    await h.loop.start();
    const old = getSnapshot();
    // Wrap the lookup so that registerFormat reports which snapshot was live.
    const inner = (
      h.loop as unknown as {
        lookup: { registerFormat: (k: string, d: never) => void };
      }
    ).lookup;
    const original = inner.registerFormat.bind(inner);
    inner.registerFormat = (k, d) => {
      registered.push(k);
      commitAtRegister.push(getSnapshot()?.commit ?? "");
      original(k, d);
    };
    const custom = [
      "schema_version: 1",
      "id: tiny",
      "name: Tiny",
      "legality_by: name",
      "sets: [M11]",
      "",
    ].join("\n");
    commit(
      h.repo,
      {
        "formats/tiny.yaml": custom,
        "t/gauntlet.yaml":
          "schema_version: 1\nname: Tiny gauntlet\nformat: repo:formats/tiny.yaml\n",
        "t/bolt.txt": "4 Lightning Bolt\n",
      },
      "add a custom format",
    );
    await h.loop.trigger("webhook");
    expect(getStatusState().lastSync.error).toBeNull();
    const snap = getSnapshot();
    expect(snap?.commit).toBe(h.head());
    expect(registered).toHaveLength(1);
    expect(commitAtRegister).toEqual([old?.commit]);
    const t = snap?.gauntlets.find((g) => g.folder === "t");
    expect(t?.formatName).toBe("Tiny");
    expect(t?.decks[0]?.errorCount).toBeGreaterThanOrEqual(0);
    expect(getStatusState().formats).toHaveLength(2);
    registered = [];
    commitAtRegister = [];
    await h.loop.stop();
  });

  it("runs one more sync for triggers that arrive mid-sync, with the latest SHA", async () => {
    const h = harness();
    await h.loop.start();
    let release!: () => void;
    h.git.gate = new Promise<void>((r) => (release = r));
    commit(h.repo, { "g/a.txt": "1 Char\n" }, "one");
    const run = h.loop.trigger("webhook");
    // Two more triggers while the first is blocked in fetch.
    void h.loop.trigger("webhook");
    void h.loop.trigger("webhook");
    commit(h.repo, { "g/b.txt": "1 Char\n" }, "two");
    h.git.gate = null;
    release();
    await run;
    expect(h.git.fetches).toBe(2);
    expect(getSnapshot()?.commit).toBe(h.head());
    await h.loop.stop();
  });

  it("rebuilds the snapshot from the same commit when new card data arrives", async () => {
    let updated = false;
    const h = harness(goodFiles(), {
      cardData: (real) => ({
        open: real.open,
        refresh: async (defs) => {
          const r = await real.refresh(defs);
          return updated ? { ...r, status: "updated" } : r;
        },
      }),
      extra: { MTGJSON_REFRESH_HOURS: "2" },
    });
    await h.loop.start();
    const first = getSnapshot();
    expect(h.clock.pending()).toContain(2 * 3_600_000);
    await h.clock.advance(2 * 3_600_000, h.settle); // refresh says unchanged
    expect(getSnapshot()).toBe(first);
    updated = true;
    await h.clock.advance(2 * 3_600_000, h.settle);
    const next = getSnapshot();
    expect(next).not.toBe(first);
    expect(next?.commit).toBe(first?.commit);
    expect(getStatusState().cardData.error).toBeNull();
    await h.loop.stop();
  });

  it("records a card data refresh failure without failing the sync", async () => {
    const h = harness(goodFiles(), {
      cardData: (real) => ({
        open: real.open,
        refresh: async (defs) => {
          const r = await real.refresh(defs);
          return {
            status: "failed",
            current: r.current,
            error: new Error("boom") as never,
          };
        },
      }),
    });
    await h.loop.start();
    // The cached copy is still usable, so the sync itself succeeds.
    expect(getStatusState().consecutiveFailures).toBe(0);
    expect(getSnapshot()).not.toBeNull();
    expect(getStatusState().cardData.error).toBe("boom");
    await h.loop.stop();
  });

  it("fails the cold start when there is no card data, and retries", async () => {
    let n = 0;
    const h = harness(goodFiles(), {
      cardData: (real) => ({
        open: real.open,
        refresh: async (defs) => {
          n++;
          if (n === 1)
            return {
              status: "failed",
              current: null,
              error: new Error("offline") as never,
            };
          return real.refresh(defs);
        },
      }),
    });
    await h.loop.start();
    expect(getSnapshot()).toBeNull();
    expect(getStatusState().lastSync.error).toContain("No usable card data");
    await h.clock.advance(30_000, h.settle);
    expect(getSnapshot()).not.toBeNull();
    expect(getStatusState().consecutiveFailures).toBe(0);
    await h.loop.stop();
  });

  it("stop waits for the running sync, but not longer than 25 s", async () => {
    const h = harness();
    await h.loop.start();
    let release!: () => void;
    h.git.gate = new Promise<void>((r) => (release = r));
    const run = h.loop.trigger("webhook");
    let stopped = false;
    const stop = h.loop.stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 100));
    expect(stopped).toBe(false);
    // No more timers fire after stop, except the 25 s limit.
    expect(h.clock.pending()).toEqual([25_000]);
    release();
    await run;
    await stop;
    expect(stopped).toBe(true);
    expect(h.clock.pending()).toEqual([]);

    const h2 = harness();
    await h2.loop.start();
    h2.git.gate = new Promise<void>(() => undefined); // never released
    void h2.loop.trigger("webhook");
    let stopped2 = false;
    const stop2 = h2.loop.stop().then(() => (stopped2 = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped2).toBe(false);
    await h2.clock.advance(25_000);
    await stop2;
    expect(stopped2).toBe(true);
  });

  it("ignores triggers after stop", async () => {
    const h = harness();
    await h.loop.start();
    await h.loop.stop();
    await h.loop.trigger("webhook");
    expect(h.git.fetches).toBe(0);
  });
});
