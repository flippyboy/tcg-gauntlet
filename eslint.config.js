import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.svelte-kit/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/generated/**",
      "docs/**",
      "spikes/**",
      "conformance/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.svelte"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    // The engine does no I/O (see CLAUDE.md, Repository layout). The rule covers the
    // engine's source only: its build scripts and its tests read and write files.
    files: ["packages/engine/src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "fs",
            "node:fs",
            "fs/promises",
            "node:fs/promises",
            "net",
            "node:net",
            "child_process",
            "node:child_process",
          ].map((name) => ({
            name,
            message: "packages/engine must not do I/O.",
          })),
        },
      ],
    },
  },
  {
    // Svelte pages. The app serves from the site root (no `base`), and its links are
    // built on the server, so `resolve()` adds nothing. `prefer-const` mis-reads
    // `let { data } = $props()`: the svelte plugin's own rule replaces it.
    files: ["packages/app/**/*.svelte"],
    rules: {
      "svelte/no-navigation-without-resolve": "off",
      "prefer-const": "off",
    },
  },
  {
    // The app's tests call route functions with partial events and read their
    // untyped results.
    files: ["packages/app/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Plain JS config files are not part of any tsconfig project.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
