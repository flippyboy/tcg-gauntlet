import { building } from "$app/env";
import type { Handle, ServerInit } from "@sveltejs/kit/hooks";
import { ConfigError, getConfig } from "#lib/server/config";
import { log, logger, setLogLevel } from "#lib/server/logger";
import { startSync, stopSync } from "#lib/server/sync";

// Starts the sync loop once, unless this is the build (`vite build` imports the server
// code to analyse it and must not clone anything).
export const init: ServerInit = () => {
  if (building) return;
  try {
    const config = getConfig();
    setLogLevel(config.logLevel);
    if (config.testMode)
      logger.warn(
        "ALLOW_INSECURE_TEST_REPO_URL is set: test mode, unsupported in production",
      );
    // adapter-node emits this event when it shuts down.
    (process as NodeJS.EventEmitter).on("sveltekit:shutdown", () => {
      void stopSync();
    });
    startSync(config);
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
};

export const handle: Handle = async ({ event, resolve }) => {
  const started = Date.now();
  const response = await resolve(event);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  log("info", "request", {
    method: event.request.method,
    path: event.url.pathname,
    status: response.status,
    durationMs: Date.now() - started,
  });
  return response;
};
