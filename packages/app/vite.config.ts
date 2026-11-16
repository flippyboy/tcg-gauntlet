import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// SvelteKit 3 no longer reads `svelte.config.js`: its configuration is the argument
// of the `sveltekit()` plugin.
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      // Technical Plan, Security: the Content Security Policy. `mode: "auto"` gives
      // server-rendered pages a nonce for their inline scripts.
      csp: {
        mode: "auto",
        directives: {
          "default-src": ["self"],
          "script-src": ["self"],
          "style-src": ["self", "unsafe-inline"],
          "img-src": ["self", "https://cards.scryfall.io", "data:", "blob:"],
          "connect-src": ["self"],
          "frame-src": ["none"],
          "object-src": ["none"],
          "base-uri": ["self"],
        },
      },
    }),
  ],
  ssr: {
    // The workspace packages stay external, so that `@tcg-gauntlet/carddata` is
    // evaluated (and sets SQLITE_USE_URI) as a normal module, not inlined.
    external: [
      "@tcg-gauntlet/engine",
      "@tcg-gauntlet/carddata",
      "@tcg-gauntlet/repo",
    ],
  },
});
