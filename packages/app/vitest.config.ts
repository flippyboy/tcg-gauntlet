// Unit and integration tests of the server side. They do not run the SvelteKit
// plugin: the server modules and the route handlers are plain TypeScript, and
// `#lib` comes from package.json `imports`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `$app/env` exists only inside SvelteKit. A stub stands in for it.
      "$app/env": fileURLToPath(
        new URL("./test/stubs/app-env.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
