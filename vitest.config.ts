import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

// One project per package under packages/. Vitest refuses an empty projects list,
// so before the first package exists (Phase 1) `projects` is left out entirely.
const projects = existsSync("packages")
  ? readdirSync("packages", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `packages/${d.name}`)
  : [];

export default defineConfig({
  test: {
    ...(projects.length > 0 ? { projects } : {}),
    exclude: ["**/e2e/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      // Source only. Generated code (the engine's schema validators) is checked by
      // regenerating it in CI, and built output would count the same code twice.
      include: ["packages/*/src/**"],
      exclude: ["**/generated/**", "**/*.d.ts", "**/*.svelte", "**/*.html"],
      thresholds: {
        "packages/{engine,carddata}/src/**": { branches: 85 },
        "packages/{repo,validator,conformance}/src/**": { branches: 70 },
        "packages/app/src/lib/server/**": { branches: 70 },
      },
    },
  },
});
