import { json } from "@sveltejs/kit";
import { getConfig } from "#lib/server/config";
import { getSnapshot } from "#lib/server/snapshot";
import { getStatusState, statusJson } from "#lib/server/status";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  const config = getConfig();
  return json(
    await statusJson({
      dataDir: config.dataDir,
      publicBaseUrl: config.publicBaseUrl,
      webhookEnabled: config.webhookSecret !== null,
      ready: getSnapshot() !== null && getStatusState().cardDataReady,
    }),
  );
};
