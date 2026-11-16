// The status store: what `/status`, `/readyz` and the page footer report.
import { statfs } from "node:fs/promises";
import { ENGINE_VERSION } from "@tcg-gauntlet/engine";

export interface LastSync {
  commit: string | null;
  /** ISO time. */
  started: string | null;
  finished: string | null;
  durationMs: number | null;
  /** The error of the last sync, or null when it succeeded. */
  error: string | null;
}

export interface CardDataStatus {
  version: string | null;
  date: string | null;
  sha256: string | null;
  lastCheck: string | null;
  error: string | null;
}

export interface StatusState {
  lastSync: LastSync;
  /** Failed syncs in a row since the last success. */
  consecutiveFailures: number;
  /** ISO time of the first failure since the last success. */
  staleSince: string | null;
  cardData: CardDataStatus;
  /** Format keys built in the derived file. */
  formats: string[];
  history: "building" | "ready";
  /** True when the derived index and the card data are open. */
  cardDataReady: boolean;
}

/** The number of failed syncs in a row after which pages show the stale banner. */
export const STALE_BANNER_FAILURES = 3;

const initial = (): StatusState => ({
  lastSync: {
    commit: null,
    started: null,
    finished: null,
    durationMs: null,
    error: null,
  },
  consecutiveFailures: 0,
  staleSince: null,
  cardData: {
    version: null,
    date: null,
    sha256: null,
    lastCheck: null,
    error: null,
  },
  formats: [],
  history: "building",
  cardDataReady: false,
});

let state: StatusState = initial();

export function getStatusState(): Readonly<StatusState> {
  return state;
}

/** Merges a partial update into the status. */
export function updateStatus(patch: {
  lastSync?: Partial<LastSync>;
  consecutiveFailures?: number;
  staleSince?: string | null;
  cardData?: Partial<CardDataStatus>;
  formats?: string[];
  history?: "building" | "ready";
  cardDataReady?: boolean;
}): void {
  const { lastSync, cardData, ...rest } = patch;
  state = {
    ...state,
    ...rest,
    lastSync: { ...state.lastSync, ...lastSync },
    cardData: { ...state.cardData, ...cardData },
  };
}

export function resetStatus(): void {
  state = initial();
}

/** True when pages must show "Content may be out of date since ...". */
export function isStale(): boolean {
  return (
    state.consecutiveFailures >= STALE_BANNER_FAILURES &&
    state.staleSince !== null
  );
}

/** Free space of the volume that holds `dir`, in bytes, or null when unknown. */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export interface StatusJson {
  engineVersion: string;
  ready: boolean;
  lastSync: LastSync;
  consecutive_failures: number;
  stale_since: string | null;
  card_data: {
    version: string | null;
    date: string | null;
    sha256: string | null;
    last_check: string | null;
    error: string | null;
  };
  formats: string[];
  history: "building" | "ready";
  disk_free_bytes: number | null;
  webhook_url: string | null;
}

/** The body of `/status`. */
export async function statusJson(opts: {
  dataDir: string;
  publicBaseUrl: string | null;
  webhookEnabled: boolean;
  ready: boolean;
}): Promise<StatusJson> {
  const s = state;
  return {
    engineVersion: ENGINE_VERSION,
    ready: opts.ready,
    lastSync: s.lastSync,
    consecutive_failures: s.consecutiveFailures,
    stale_since: s.staleSince,
    card_data: {
      version: s.cardData.version,
      date: s.cardData.date,
      sha256: s.cardData.sha256,
      last_check: s.cardData.lastCheck,
      error: s.cardData.error,
    },
    formats: s.formats,
    history: s.history,
    disk_free_bytes: await freeDiskBytes(opts.dataDir),
    webhook_url:
      opts.webhookEnabled && opts.publicBaseUrl !== null
        ? `${opts.publicBaseUrl}/webhook/github`
        : null,
  };
}
