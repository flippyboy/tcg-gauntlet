import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  handleWebhook,
  resetWebhookThrottle,
} from "../src/lib/server/webhook.js";

const SECRET = "topsecret";
const sign = (body: string, secret = SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function req(body: string, headers: Record<string, string>): Request {
  return new Request("http://x/webhook/github", {
    method: "POST",
    body,
    headers,
  });
}

let triggers: string[];
let now: number;
const deps = (secret: string | null = SECRET) => ({
  secret,
  branch: "main",
  trigger: (r: string) => triggers.push(r),
  now: () => now,
});
const push = (ref = "refs/heads/main", secret = SECRET): Request => {
  const body = JSON.stringify({ ref });
  return req(body, {
    "x-hub-signature-256": sign(body, secret),
    "x-github-event": "push",
  });
};

beforeEach(() => {
  triggers = [];
  now = 1_000_000;
  resetWebhookThrottle();
});

describe("webhook", () => {
  it("answers 404 when no secret is set", async () => {
    expect(await handleWebhook(push(), deps(null))).toBe(404);
  });

  it("answers 401 for a missing or bad signature", async () => {
    expect(
      await handleWebhook(req("{}", { "x-github-event": "push" }), deps()),
    ).toBe(401);
    expect(await handleWebhook(push("refs/heads/main", "wrong"), deps())).toBe(
      401,
    );
    expect(
      await handleWebhook(
        req("{}", {
          "x-hub-signature-256": "sha256=zz",
          "x-github-event": "push",
        }),
        deps(),
      ),
    ).toBe(401);
    expect(
      await handleWebhook(
        req("{}", {
          "x-hub-signature-256": "md5=00",
          "x-github-event": "push",
        }),
        deps(),
      ),
    ).toBe(401);
    expect(triggers).toEqual([]);
  });

  it("triggers a sync for a signed push to the tracked branch", async () => {
    expect(await handleWebhook(push(), deps())).toBe(202);
    expect(triggers).toEqual(["webhook"]);
  });

  it("ignores other events and other branches with 202", async () => {
    const body = "{}";
    const ping = req(body, {
      "x-hub-signature-256": sign(body),
      "x-github-event": "ping",
    });
    expect(await handleWebhook(ping, deps())).toBe(202);
    const issues = req(body, {
      "x-hub-signature-256": sign(body),
      "x-github-event": "issues",
    });
    expect(await handleWebhook(issues, deps())).toBe(202);
    expect(await handleWebhook(push("refs/heads/other"), deps())).toBe(202);
    const bad = req("not json", {
      "x-hub-signature-256": sign("not json"),
      "x-github-event": "push",
    });
    expect(await handleWebhook(bad, deps())).toBe(202);
    expect(triggers).toEqual([]);
  });

  it("answers 429 for a second trigger within 5 seconds", async () => {
    expect(await handleWebhook(push(), deps())).toBe(202);
    now += 4999;
    expect(await handleWebhook(push(), deps())).toBe(429);
    now += 1;
    expect(await handleWebhook(push(), deps())).toBe(202);
    expect(triggers).toHaveLength(2);
  });
});
