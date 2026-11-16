// The sync loop (Technical Plan, "packages/app"). One background loop per process:
// trigger, fetch, scan, formats, history, snapshot, swap. Its collaborators (git, the
// card data layer, the scan, the clock) are injected, so tests can drive it with a
// fake clock and fake failures.
import { rm } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CardLookup } from "@tcg-gauntlet/engine";
import {
  type FormatBuild,
  type OpenCurrentResult,
  type RefreshResult,
  openCurrent,
  refreshCardData,
} from "@tcg-gauntlet/carddata";
import {
  type RepoContents,
  Git,
  isFormatFailure,
  scanRepo,
} from "@tcg-gauntlet/repo";
import type { Config } from "./config.js";
import { History } from "./history.js";
import { logger } from "./logger.js";
import {
  buildSnapshot,
  getSnapshot,
  resolveGauntletFormats,
  setSnapshot,
} from "./snapshot.js";
import { getStatusState, updateStatus } from "./status.js";

export type SyncReason = "startup" | "poll" | "webhook" | "refresh" | "rerun";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Uniform in [0, 1). */
  random(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  random: () => Math.random(),
};

export type LookupHandle = CardLookup & { close(): void };

/** The card data layer: MTGJSON refresh and opening the current version. */
export interface CardDataLayer {
  refresh(formatDefs: FormatBuild[]): Promise<RefreshResult>;
  open(
    formatDefs: FormatBuild[],
    verifyChecksum: boolean,
  ): Promise<OpenCurrentResult>;
}

export type GitLike = Pick<
  Git,
  "clone" | "fetch" | "resetHard" | "lsRemote" | "revParse" | "isRepoHealthy"
>;

export interface SyncDeps {
  config: Config;
  git: GitLike;
  cardData: CardDataLayer;
  history: History;
  scan?: (dir: string) => Promise<RepoContents>;
  clock?: Clock;
}

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 600_000;
export const STOP_WAIT_MS = 25_000;

/** 30 s, 60 s, 120 s ... capped at 10 min, for the n-th failure in a row (n >= 1). */
export function backoffMs(failures: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1),
    BACKOFF_MAX_MS,
  );
}

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export class SyncLoop {
  private readonly clock: Clock;
  private readonly scan: (dir: string) => Promise<RepoContents>;
  private lookup: LookupHandle | null = null;
  private contents: RepoContents | null = null;
  /** Format keys that are built in the open derived file. */
  private known = new Set<string>();
  private running: Promise<void> | null = null;
  private pending: SyncReason | null = null;
  private stopped = false;
  private pollTimer: unknown = null;
  private refreshTimer: unknown = null;

  constructor(private readonly deps: SyncDeps) {
    this.clock = deps.clock ?? realClock;
    this.scan = deps.scan ?? scanRepo;
  }

  get history(): History {
    return this.deps.history;
  }

  /** Runs the first sync and arms the timers. Resolves when the first sync finished. */
  start(): Promise<void> {
    this.armRefresh();
    return this.trigger("startup");
  }

  /** The loop that is running now, for tests. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /**
   * Single-flight: while a sync runs, a trigger is remembered and one more sync runs
   * afterwards. That sync fetches the latest remote SHA, not the one that triggered it.
   */
  trigger(reason: SyncReason): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running !== null) {
      this.pending = "rerun";
      return this.running;
    }
    this.clearPoll();
    this.running = (async () => {
      let why: SyncReason | null = reason;
      while (why !== null && !this.stopped) {
        this.pending = null;
        await this.cycle(why);
        why = this.pending;
      }
    })().finally(() => {
      this.running = null;
      if (!this.stopped) this.armPoll();
    });
    return this.running;
  }

  // ------------------------------------------------------------------ timers

  private clearPoll(): void {
    if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private armPoll(): void {
    this.clearPoll();
    const failures = getStatusState().consecutiveFailures;
    const base = this.deps.config.pollIntervalSeconds * 1000;
    const delay =
      failures > 0
        ? backoffMs(failures)
        : Math.round(base * (0.9 + this.clock.random() * 0.2));
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = null;
      void this.trigger("poll");
    }, delay);
  }

  private armRefresh(): void {
    if (this.refreshTimer !== null) this.clock.clearTimeout(this.refreshTimer);
    this.refreshTimer = this.clock.setTimeout(() => {
      void this.refreshCardData();
    }, this.deps.config.mtgjsonRefreshHours * 3_600_000);
  }

  /** Stops the timers and waits for the current sync, at most 25 s. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearPoll();
    if (this.refreshTimer !== null) this.clock.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const running = this.running;
    if (running !== null) {
      let timer: unknown;
      const limit = new Promise<void>((r) => {
        timer = this.clock.setTimeout(r, STOP_WAIT_MS);
      });
      await Promise.race([running.catch(() => undefined), limit]);
      this.clock.clearTimeout(timer);
    }
    this.deps.history.close();
  }

  // ------------------------------------------------------------ the sync cycle

  private fail(started: number, e: unknown): void {
    const st = getStatusState();
    const finished = this.clock.now();
    const n = st.consecutiveFailures + 1;
    updateStatus({
      consecutiveFailures: n,
      staleSince: st.staleSince ?? new Date(finished).toISOString(),
      lastSync: {
        started: new Date(started).toISOString(),
        finished: new Date(finished).toISOString(),
        durationMs: finished - started,
        error: msg(e),
      },
    });
    logger.error("sync failed", {
      err: e,
      durationMs: finished - started,
      failures: n,
    });
  }

  private succeed(): void {
    updateStatus({ consecutiveFailures: 0, staleSince: null });
  }

  private async cycle(reason: SyncReason): Promise<void> {
    const started = this.clock.now();
    try {
      await this.runCycle(reason, started);
    } catch (e) {
      this.fail(started, e);
    }
  }

  private async runCycle(reason: SyncReason, started: number): Promise<void> {
    const { config, git, history } = this.deps;
    const snap = getSnapshot();

    // 1. Trigger. A poll compares the remote SHA with the snapshot first.
    if (reason === "poll" && snap !== null) {
      const r = await git.lsRemote(config.repoDir, config.branch);
      if ("error" in r) {
        throw new Error(
          `${r.throttled ? "GitHub throttled the poll: " : ""}${r.error}`,
        );
      }
      if (r.sha === snap.commit && this.lookup !== null) {
        this.succeed();
        return;
      }
    }

    // 2. Fetch (or clone), together with the MTGJSON refresh on a cold start.
    const needData = this.lookup === null;
    const [head, refresh] = await Promise.all([
      this.updateClone(),
      needData ? this.deps.cardData.refresh([]) : Promise.resolve(null),
    ]);
    if (refresh !== null) this.noteRefresh(refresh);

    // 3. Scan. Every file is read into memory here.
    const contents = await this.scan(config.repoDir);

    // 4. Formats: finished before the swap, so a new format delays the update.
    const formats = await resolveGauntletFormats(contents, config.presetsDir);
    const builds: FormatBuild[] = [];
    for (const f of formats) {
      const r = f.resolution;
      if (r !== null && !isFormatFailure(r))
        builds.push({ key: r.key, def: r.def });
    }
    let current = this.lookupCurrent();
    if (needData) {
      const opened = await this.deps.cardData.open(
        builds,
        refresh?.status !== "updated",
      );
      if (!opened.ok) {
        const why = refresh?.error?.message ?? "";
        throw new Error(
          `No usable card data (${opened.reason})${why === "" ? "" : `: ${why}`}`,
        );
      }
      this.lookup = opened.lookup;
      this.known = new Set(builds.map((b) => b.key));
      current = opened.current;
      this.noteCurrent(opened.current);
    }
    const lookup = this.lookup as LookupHandle;
    for (const b of builds) {
      if (this.known.has(b.key)) continue;
      if (b.def !== null) lookup.registerFormat?.(b.key, b.def);
      this.known.add(b.key);
    }

    // 5. History.
    updateStatus({ history: "building" });
    const mode = await history.update(head);
    updateStatus({ history: "ready" });
    logger.info("history updated", { commit: head, mode });

    // 6 and 7. Build the snapshot and swap it in.
    await this.swap(contents, head, current, started);
    this.succeed();
  }

  private lookupCurrent(): { version: string; date: string; sha256: string } {
    const s = getStatusState().cardData;
    return {
      version: s.version ?? "",
      date: s.date ?? "",
      sha256: s.sha256 ?? "",
    };
  }

  private async swap(
    contents: RepoContents,
    commit: string,
    current: { version: string; date: string; sha256: string },
    started: number,
  ): Promise<void> {
    const lookup = this.lookup as LookupHandle;
    const next = await buildSnapshot(contents, lookup, {
      presetsDir: this.deps.config.presetsDir,
      commit,
      mtgjson: { version: current.version, date: current.date },
      lastUpdated: this.deps.history.lastUpdatedMap(),
      now: () => new Date(this.clock.now()),
    });
    this.contents = contents;
    setSnapshot(next);
    const finished = this.clock.now();
    updateStatus({
      lastSync: {
        commit,
        started: new Date(started).toISOString(),
        finished: new Date(finished).toISOString(),
        durationMs: finished - started,
        error: null,
      },
      formats: next.formats,
      cardDataReady: true,
    });
    logger.info("sync done", { commit, durationMs: finished - started });
  }

  /**
   * Clones when there is no usable clone, otherwise fetches and resets to the latest
   * remote SHA. When the fetch fails and the clone is damaged, it is deleted and cloned
   * again. Returns the SHA that is checked out.
   */
  private async updateClone(): Promise<string> {
    const { config, git, history } = this.deps;
    const dir = config.repoDir;
    const clone = async (): Promise<void> => {
      await rm(dir, { recursive: true, force: true });
      mkdirSync(config.dataDir, { recursive: true });
      history.stopCatFile();
      await git.clone(config.deckRepoUrl, dir, config.branch);
    };
    if (!existsSync(join(dir, ".git"))) {
      await clone();
    } else {
      try {
        await git.fetch(dir, config.branch);
      } catch (e) {
        if (await git.isRepoHealthy(dir)) throw e;
        logger.warn("the clone is damaged, cloning again", { err: e });
        await clone();
      }
    }
    const ref = `refs/remotes/origin/${config.branch}`;
    const sha = await git.revParse(dir, ref);
    await git.resetHard(dir, sha);
    return sha;
  }

  // ------------------------------------------------------------- card data

  private noteRefresh(r: RefreshResult): void {
    updateStatus({
      cardData: {
        lastCheck: new Date(this.clock.now()).toISOString(),
        error:
          r.status === "failed" ? (r.error?.message ?? "refresh failed") : null,
      },
    });
    if (r.status === "failed")
      logger.warn("MTGJSON refresh failed", { err: r.error });
  }

  private noteCurrent(c: {
    version: string;
    date: string;
    sha256: string;
  }): void {
    updateStatus({
      cardData: { version: c.version, date: c.date, sha256: c.sha256 },
    });
  }

  /**
   * The refresh timer: checks MTGJSON, and when there is new data, rebuilds the snapshot
   * from the same commit. It runs under the same lock as a sync.
   */
  async refreshCardData(): Promise<void> {
    if (this.stopped) return;
    if (this.running !== null) {
      // A sync is running. Try again when it is over.
      await this.running.catch(() => undefined);
    }
    if (this.stopped || this.lookup === null || this.contents === null) {
      this.armRefresh();
      return;
    }
    const run = (async () => {
      const started = this.clock.now();
      try {
        const snap = getSnapshot();
        const formats = await resolveGauntletFormats(
          this.contents as RepoContents,
          this.deps.config.presetsDir,
        );
        const builds: FormatBuild[] = [];
        for (const f of formats) {
          const r = f.resolution;
          if (r !== null && !isFormatFailure(r))
            builds.push({ key: r.key, def: r.def });
        }
        const r = await this.deps.cardData.refresh(builds);
        this.noteRefresh(r);
        if (r.status !== "updated" || snap === null) return;
        const opened = await this.deps.cardData.open(builds, false);
        if (!opened.ok)
          throw new Error(`card data unusable (${opened.reason})`);
        const old = this.lookup;
        this.lookup = opened.lookup;
        this.known = new Set(builds.map((b) => b.key));
        this.noteCurrent(opened.current);
        await this.swap(
          this.contents as RepoContents,
          snap.commit,
          opened.current,
          started,
        );
        // Requests that hold the old snapshot may still read the old lookup.
        this.clock.setTimeout(() => old?.close(), 60_000);
        logger.info("snapshot rebuilt for new card data", {
          commit: snap.commit,
        });
      } catch (e) {
        updateStatus({ cardData: { error: msg(e) } });
        logger.error("card data refresh failed", { err: e });
      }
    })();
    this.running = run.finally(() => {
      this.running = null;
    });
    await this.running;
    this.armRefresh();
  }
}

// ------------------------------------------------------------ process-wide API

let loop: SyncLoop | null = null;

export function defaultCardData(config: Config): CardDataLayer {
  return {
    refresh: (formatDefs) =>
      refreshCardData({
        baseUrl: config.mtgjsonBaseUrl,
        dataDir: config.dataDir,
        formatDefs,
        ...(config.minCards === undefined ? {} : { minCards: config.minCards }),
      }),
    open: (formatDefs, verifyChecksum) =>
      openCurrent(config.dataDir, { formatDefs, verifyChecksum }),
  };
}

/** Starts the one sync loop of the process. */
export function startSync(
  config: Config,
  overrides: Partial<SyncDeps> = {},
): SyncLoop {
  if (loop !== null) return loop;
  const git = new Git({ dataDir: config.dataDir, testMode: config.testMode });
  const history = new History(
    git,
    join(config.dataDir, "history.sqlite"),
    config.repoDir,
  );
  history.open();
  loop = new SyncLoop({
    config,
    git,
    history,
    cardData: defaultCardData(config),
    ...overrides,
  });
  void loop.start();
  return loop;
}

/** The webhook's entry point. */
export function triggerSync(reason: SyncReason): void {
  void loop?.trigger(reason);
}

/** The history of the running loop, for the version pages. */
export function getHistory(): History | null {
  return loop?.history ?? null;
}

/** Stops the timers and waits for the current sync, at most 25 s. */
export async function stopSync(): Promise<void> {
  const l = loop;
  loop = null;
  await l?.stop();
}
