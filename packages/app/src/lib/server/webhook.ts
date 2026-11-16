// The GitHub webhook: HMAC check, event filter, 5 s throttle.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookDeps {
  secret: string | null;
  branch: string;
  /** Called for an accepted trigger. */
  trigger: (reason: string) => void;
  now?: () => number;
}

export const WEBHOOK_THROTTLE_MS = 5000;

let lastTrigger = -Infinity;

/** For tests. */
export function resetWebhookThrottle(): void {
  lastTrigger = -Infinity;
}

function signatureOk(
  secret: string,
  body: Buffer,
  header: string | null,
): boolean {
  if (header === null || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(body).digest();
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Answers a webhook request with a status code. Reads only the event header and `ref`. */
export async function handleWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<number> {
  if (deps.secret === null) return 404;
  const body = Buffer.from(await request.arrayBuffer());
  if (
    !signatureOk(deps.secret, body, request.headers.get("x-hub-signature-256"))
  )
    return 401;
  const event = request.headers.get("x-github-event");
  if (event === "ping") return 202;
  if (event !== "push") return 202;
  let ref: unknown;
  try {
    ref = (JSON.parse(body.toString("utf8")) as { ref?: unknown }).ref;
  } catch {
    return 202;
  }
  if (ref !== `refs/heads/${deps.branch}`) return 202;
  const now = (deps.now ?? Date.now)();
  if (now - lastTrigger < WEBHOOK_THROTTLE_MS) return 429;
  lastTrigger = now;
  deps.trigger("webhook");
  return 202;
}
