import { getSnapshot } from "#lib/server/snapshot";
import { getStatusState } from "#lib/server/status";
import type { RequestHandler } from "./$types";

/** Ready when a snapshot, card data and the derived index exist. */
export const GET: RequestHandler = () => {
  const ready = getSnapshot() !== null && getStatusState().cardDataReady;
  return new Response(ready ? "ready\n" : "not ready\n", {
    status: ready ? 200 : 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
