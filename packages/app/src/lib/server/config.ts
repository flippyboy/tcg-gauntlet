// The environment variables of the app (Technical Plan, "Configuration").
//
// `ADDRESS_HEADER`, `XFF_DEPTH` and `ORIGIN` are read by adapter-node, not by this
// module. They are listed here for documentation only: adapter-node uses
// `ADDRESS_HEADER` and `XFF_DEPTH` to answer `getClientAddress()` (which the image
// route's rate limit uses), and `ORIGIN` for the public origin that SvelteKit checks
// form posts against. `HOST`, `PORT` and `SHUTDOWN_TIMEOUT` are also adapter-node's;
// the app validates `PORT` so that a bad value fails with a clear message.
//
// A test-only variable, `TCG_GAUNTLET_MIN_CARDS`, lowers the MTGJSON self-check
// minimum (the mini fixture has about 100 cards). It is not documented to users.
// `TCG_GAUNTLET_IMAGE_UPSTREAM` (also test only, and only with
// `ALLOW_INSECURE_TEST_REPO_URL`) replaces `https://cards.scryfall.io` as the host the
// image route fetches from, so the e2e suite needs no network.
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  /** The normalised repo URL (the configured URL as given, in test mode). */
  readonly deckRepoUrl: string;
  /** `https://github.com/<owner>/<repo>` normalised, or the test-mode URL. */
  readonly repoWebUrl: string;
  readonly branch: string;
  readonly dataDir: string;
  readonly port: number;
  readonly publicBaseUrl: string | null;
  readonly pollIntervalSeconds: number;
  readonly webhookSecret: string | null;
  readonly mtgjsonBaseUrl: string;
  readonly mtgjsonRefreshHours: number;
  readonly imageCacheMaxMb: number;
  readonly historyMaxVersions: number;
  readonly logLevel: LogLevel;
  readonly presetsDir: string;
  /** `ALLOW_INSECURE_TEST_REPO_URL`: tests only. */
  readonly testMode: boolean;
  /** `TCG_GAUNTLET_MIN_CARDS`, test only. */
  readonly minCards: number | undefined;
  /** `TCG_GAUNTLET_IMAGE_UPSTREAM`, test mode only. Undefined means Scryfall. */
  readonly imageUpstream: string | undefined;
  /** `DATA_DIR/repo`. */
  readonly repoDir: string;
}

/** Thrown for invalid variables. `messages` has one line per invalid variable. */
export class ConfigError extends Error {
  constructor(readonly messages: string[]) {
    super(
      `Invalid configuration:\n${messages.map((m) => `  ${m}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** The repo URL grammar of spec/gauntlet.md. */
const REPO_URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(\.git)?\/?$/;

/** Normalises an accepted GitHub URL, or returns null. */
export function normaliseRepoUrl(url: string): string | null {
  const m = REPO_URL_RE.exec(url);
  if (m === null) return null;
  const owner = m[1] ?? "";
  const repo = m[2] ?? "";
  if (repo === "." || repo === "..") return null;
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

/** Test-mode URLs: `file://` and `http://`, with no whitespace or control characters. */
function normaliseTestUrl(url: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f]/.test(url)) return null;
  if (/^(file|http):\/\/[^?#]+$/.test(url))
    return url.replace(/\.git$/, "").replace(/\/+$/, "");
  return null;
}

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Parses and validates the environment. Throws a `ConfigError` with one message per
 * invalid variable.
 */
export function parseConfig(env: Env = process.env): Config {
  const errors: string[] = [];
  const get = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === "" ? undefined : v;
  };
  const int = (name: string, def: number, min: number, max: number): number => {
    const raw = get(name);
    if (raw === undefined) return def;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      errors.push(
        `${name} must be an integer from ${min} to ${max}, got "${raw}"`,
      );
      return def;
    }
    return Number(raw);
  };

  let testMode = false;
  const insecure = get("ALLOW_INSECURE_TEST_REPO_URL");
  if (insecure !== undefined) {
    if (insecure === "1" || insecure === "true") testMode = true;
    else if (insecure !== "0" && insecure !== "false")
      errors.push(
        `ALLOW_INSECURE_TEST_REPO_URL must be 1 or true when it is set, got "${insecure}"`,
      );
  }

  let deckRepoUrl = "";
  let repoWebUrl = "";
  const rawUrl = get("DECK_REPO_URL");
  if (rawUrl === undefined) {
    errors.push("DECK_REPO_URL is required");
  } else {
    const norm = normaliseRepoUrl(rawUrl);
    if (norm !== null) {
      // In production the clone URL is the normalised one, so that git never sees
      // user info or a path the grammar does not allow.
      deckRepoUrl = norm;
      repoWebUrl = norm;
    } else if (testMode) {
      const t = normaliseTestUrl(rawUrl);
      if (t === null)
        errors.push(
          `DECK_REPO_URL must be an https://github.com/<owner>/<repo> URL, or a file:// or http:// URL in test mode, got "${rawUrl}"`,
        );
      else {
        deckRepoUrl = rawUrl.replace(/\/+$/, "");
        repoWebUrl = t;
      }
    } else {
      errors.push(
        `DECK_REPO_URL must be an https://github.com/<owner>/<repo> URL, got "${rawUrl}"`,
      );
    }
  }

  const branch = get("DECK_REPO_BRANCH") ?? "main";
  if (
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith("-") ||
    branch.includes("..")
  ) {
    errors.push(`DECK_REPO_BRANCH is not a safe branch name, got "${branch}"`);
  }

  const port = int("PORT", 3000, 1, 65535);
  const pollIntervalSeconds = int("POLL_INTERVAL_SECONDS", 30, 10, 3600);
  const mtgjsonRefreshHours = int("MTGJSON_REFRESH_HOURS", 24, 1, 168);
  const imageCacheMaxMb = int("IMAGE_CACHE_MAX_MB", 500, 50, 100000);
  const historyMaxVersions = int("HISTORY_MAX_VERSIONS", 100, 1, 10000);

  let logLevel: LogLevel = "info";
  const rawLevel = get("LOG_LEVEL");
  if (rawLevel !== undefined) {
    if ((LEVELS as readonly string[]).includes(rawLevel))
      logLevel = rawLevel as LogLevel;
    else
      errors.push(
        `LOG_LEVEL must be one of ${LEVELS.join(", ")}, got "${rawLevel}"`,
      );
  }

  const mtgjsonBaseUrl =
    get("MTGJSON_BASE_URL") ?? "https://mtgjson.com/api/v5";
  if (!/^https?:\/\/[^\s]+$/.test(mtgjsonBaseUrl))
    errors.push(
      `MTGJSON_BASE_URL must be an http(s) URL, got "${mtgjsonBaseUrl}"`,
    );

  const publicBaseUrl = get("PUBLIC_BASE_URL") ?? null;
  if (publicBaseUrl !== null && !/^https?:\/\/[^\s]+$/.test(publicBaseUrl))
    errors.push(
      `PUBLIC_BASE_URL must be an http(s) URL, got "${publicBaseUrl}"`,
    );

  let minCards: number | undefined;
  const rawMin = get("TCG_GAUNTLET_MIN_CARDS");
  if (rawMin !== undefined) {
    if (/^\d+$/.test(rawMin)) minCards = Number(rawMin);
    else
      errors.push(`TCG_GAUNTLET_MIN_CARDS must be an integer, got "${rawMin}"`);
  }

  let imageUpstream: string | undefined;
  const rawUpstream = get("TCG_GAUNTLET_IMAGE_UPSTREAM");
  if (rawUpstream !== undefined) {
    if (!testMode)
      errors.push(
        "TCG_GAUNTLET_IMAGE_UPSTREAM needs ALLOW_INSECURE_TEST_REPO_URL (test only)",
      );
    else if (!/^https?:\/\/[^\s]+$/.test(rawUpstream))
      errors.push(
        `TCG_GAUNTLET_IMAGE_UPSTREAM must be an http(s) URL, got "${rawUpstream}"`,
      );
    else imageUpstream = rawUpstream;
  }

  if (errors.length > 0) throw new ConfigError(errors);

  const dataDir = get("DATA_DIR") ?? "/data";
  return Object.freeze({
    deckRepoUrl,
    repoWebUrl,
    branch,
    dataDir,
    port,
    publicBaseUrl:
      publicBaseUrl === null ? null : publicBaseUrl.replace(/\/+$/, ""),
    pollIntervalSeconds,
    webhookSecret: get("WEBHOOK_SECRET") ?? null,
    mtgjsonBaseUrl,
    mtgjsonRefreshHours,
    imageCacheMaxMb,
    historyMaxVersions,
    logLevel,
    presetsDir: get("PRESETS_DIR") ?? "/app/presets",
    testMode,
    minCards,
    imageUpstream,
    repoDir: join(dataDir, "repo"),
  });
}

let current: Config | undefined;

/** The process-wide config, parsed from `process.env` on first use. */
export function getConfig(): Config {
  current ??= parseConfig();
  return current;
}

/** For tests: replaces (or with `undefined` clears) the process-wide config. */
export function setConfig(config: Config | undefined): void {
  current = config;
}
