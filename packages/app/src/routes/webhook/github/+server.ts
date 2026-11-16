import { requireSnapshot } from "#lib/server/app-state";
import { getConfig } from "#lib/server/config";
import { triggerSync } from "#lib/server/sync";
import { handleWebhook } from "#lib/server/webhook";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  requireSnapshot();
  const config = getConfig();
  const status = await handleWebhook(request, {
    secret: config.webhookSecret,
    branch: config.branch,
    trigger: () => triggerSync("webhook"),
  });
  return new Response(null, { status });
};
