## Model Selection for EGM

When running Elephant-Goldfish Model (EGM) stages, always use:
- **Elephant (brainstorm/draft):** `claude-opus-5-5`
- **Goldfish reviewers (comprehension, basic review):** `claude-haiku-5-5`
- **Goldfish reviewers (hostile critic, readiness):** `claude-sonnet-5-5`
- **Implementation:** `claude-sonnet-5-5`

## Repository layout

- `packages/engine`: pure TypeScript. Parses, resolves, validates, diffs and exports decks. Takes a `CardLookup`. **No I/O**: it must not import `fs`, `net` or `child_process` (ESLint enforces this).
- `packages/carddata`: MTGJSON download, checksum and cache; derived format tables; the SQLite `CardLookup` implementation (better-sqlite3).
- `packages/conformance`: the conformance corpus runner and fixtures support. Fixtures live in `conformance/` and are byte-exact.
- `packages/repo`: git wrapper, repo scan, limits, format resolution, affected decks. Shared by the validator and the app.
- `packages/validator`: the CLI, its Docker image and the GitHub Action (`actions/validate`).
- `packages/app`: the SvelteKit app (`adapter-node`): sync loop, history, pages, exports, `/img` route, webhook. It has its own tsconfig and is not part of `tsc -b`.
- Every MTGJSON SQL query lives in `mtgjson-queries.ts`. No other file contains SQL against MTGJSON tables.
