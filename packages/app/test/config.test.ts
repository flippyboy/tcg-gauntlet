import { describe, expect, it } from "vitest";
import {
  ConfigError,
  normaliseRepoUrl,
  parseConfig,
} from "../src/lib/server/config.js";

const base = { DECK_REPO_URL: "https://github.com/Owner/Repo.git" };

function errors(env: Record<string, string>): string[] {
  try {
    parseConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e.messages;
    throw e;
  }
  return [];
}

describe("config", () => {
  it("applies the defaults and normalises the URL", () => {
    const c = parseConfig(base);
    expect(c.deckRepoUrl).toBe("https://github.com/owner/repo");
    expect(c).toMatchObject({
      branch: "main",
      dataDir: "/data",
      port: 3000,
      pollIntervalSeconds: 30,
      mtgjsonRefreshHours: 24,
      imageCacheMaxMb: 500,
      historyMaxVersions: 100,
      logLevel: "info",
      presetsDir: "/app/presets",
      testMode: false,
      publicBaseUrl: null,
      webhookSecret: null,
      repoDir: "/data/repo",
    });
    expect(Object.isFrozen(c)).toBe(true);
  });

  it("requires DECK_REPO_URL", () => {
    expect(errors({})).toEqual(["DECK_REPO_URL is required"]);
  });

  it.each([
    ["POLL_INTERVAL_SECONDS", "9", "10"],
    ["POLL_INTERVAL_SECONDS", "3601", "3600"],
    ["MTGJSON_REFRESH_HOURS", "0", "1"],
    ["MTGJSON_REFRESH_HOURS", "169", "168"],
    ["IMAGE_CACHE_MAX_MB", "49", "50"],
    ["IMAGE_CACHE_MAX_MB", "100001", "100000"],
    ["HISTORY_MAX_VERSIONS", "0", "1"],
    ["HISTORY_MAX_VERSIONS", "10001", "10000"],
    ["PORT", "0", "1"],
    ["PORT", "65536", "65535"],
    ["PORT", "abc", "1"],
  ])("rejects %s=%s", (name, value) => {
    const e = errors({ ...base, [name]: value });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain(name);
  });

  it("accepts the range limits", () => {
    const c = parseConfig({
      ...base,
      POLL_INTERVAL_SECONDS: "10",
      MTGJSON_REFRESH_HOURS: "168",
      IMAGE_CACHE_MAX_MB: "50",
      HISTORY_MAX_VERSIONS: "10000",
      PORT: "65535",
    });
    expect(c.pollIntervalSeconds).toBe(10);
    expect(c.port).toBe(65535);
  });

  it("gives one message per invalid variable", () => {
    const e = errors({
      DECK_REPO_URL: "http://example.com/x",
      PORT: "x",
      POLL_INTERVAL_SECONDS: "1",
      LOG_LEVEL: "loud",
      DECK_REPO_BRANCH: "--evil",
      MTGJSON_BASE_URL: "ftp://x",
      PUBLIC_BASE_URL: "nope",
      TCG_GAUNTLET_MIN_CARDS: "many",
    });
    expect(e).toHaveLength(8);
  });

  it("accepts only 1 or true for the test mode flag", () => {
    expect(
      parseConfig({ ...base, ALLOW_INSECURE_TEST_REPO_URL: "1" }).testMode,
    ).toBe(true);
    expect(
      parseConfig({ ...base, ALLOW_INSECURE_TEST_REPO_URL: "true" }).testMode,
    ).toBe(true);
    expect(
      errors({ ...base, ALLOW_INSECURE_TEST_REPO_URL: "yes" }),
    ).toHaveLength(1);
    expect(
      parseConfig({ ...base, ALLOW_INSECURE_TEST_REPO_URL: "false" }).testMode,
    ).toBe(false);
  });

  it("allows file:// and http:// URLs in test mode only", () => {
    const url = "file:///tmp/some repo".replace(" ", "");
    expect(errors({ DECK_REPO_URL: url })).toHaveLength(1);
    const c = parseConfig({
      DECK_REPO_URL: `${url}/`,
      ALLOW_INSECURE_TEST_REPO_URL: "1",
    });
    expect(c.deckRepoUrl).toBe(url);
    expect(c.repoWebUrl).toBe(url);
    expect(
      errors({ DECK_REPO_URL: "ssh://x/y", ALLOW_INSECURE_TEST_REPO_URL: "1" }),
    ).toHaveLength(1);
    expect(
      errors({
        DECK_REPO_URL: "file:///a b",
        ALLOW_INSECURE_TEST_REPO_URL: "1",
      }),
    ).toHaveLength(1);
  });

  it("checks the URL grammar", () => {
    expect(normaliseRepoUrl("https://github.com/a/b/")).toBe(
      "https://github.com/a/b",
    );
    expect(normaliseRepoUrl("https://github.com/a/..")).toBeNull();
    expect(normaliseRepoUrl("https://user@github.com/a/b")).toBeNull();
    expect(normaliseRepoUrl("https://github.com/a/b/tree/x")).toBeNull();
    expect(normaliseRepoUrl("https://github.com/a/b?x=1")).toBeNull();
  });

  it("reads the optional values", () => {
    const c = parseConfig({
      ...base,
      DATA_DIR: "/x",
      PUBLIC_BASE_URL: "https://decks.example.com/",
      WEBHOOK_SECRET: "s",
      LOG_LEVEL: "debug",
      TCG_GAUNTLET_MIN_CARDS: "5",
      PRESETS_DIR: "/p",
    });
    expect(c).toMatchObject({
      dataDir: "/x",
      publicBaseUrl: "https://decks.example.com",
      webhookSecret: "s",
      logLevel: "debug",
      minCards: 5,
      presetsDir: "/p",
    });
  });

  it("accepts the image upstream only in test mode", () => {
    const test = {
      DECK_REPO_URL: "file:///tmp/repo",
      ALLOW_INSECURE_TEST_REPO_URL: "1",
    };
    expect(parseConfig(test).imageUpstream).toBeUndefined();
    expect(
      parseConfig({
        ...test,
        TCG_GAUNTLET_IMAGE_UPSTREAM: "http://127.0.0.1:9",
      }).imageUpstream,
    ).toBe("http://127.0.0.1:9");
    expect(
      errors({ ...base, TCG_GAUNTLET_IMAGE_UPSTREAM: "http://127.0.0.1:9" }),
    ).toEqual([expect.stringContaining("TCG_GAUNTLET_IMAGE_UPSTREAM")]);
    expect(errors({ ...test, TCG_GAUNTLET_IMAGE_UPSTREAM: "ftp://x" })).toEqual(
      [expect.stringContaining("http(s) URL")],
    );
  });
});
