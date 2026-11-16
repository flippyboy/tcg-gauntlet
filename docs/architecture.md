# Architecture

This is a short guide for people who change the code. It describes how the parts fit together and what rules the code keeps. The reasons for the choices, the alternatives that were rejected, and the spike results are in the [design document](designs/tcg-gauntlet.md). The file formats are in [spec/](../spec/README.md). If this page and the code differ, the code is right.

## What the project does

A deck repo is a git repo of deck files. TCG Gauntlet does two jobs with it:

- The **validator** checks decks against a format. It runs as a CLI, a Docker image and a GitHub Action, usually on pull requests.
- The **app** is a web server for one deck repo. It shows the decks, their version history and the differences between versions, and it exports decks.

Both jobs use the same rules code, so they give the same verdicts.

## Packages

```text
spec/  presets/  conformance/
        |
packages/engine      pure functions: parse, resolve, validate, diff, export
        | CardLookup interface
packages/carddata    MTGJSON download and cache, derived tables, SQLite CardLookup
        |
packages/repo        git wrapper, repo scan, limits, format resolution, affected decks
        |
   +----+-----------------------------+
   |                                  |
packages/validator              packages/app
CLI, image, GitHub Action       SvelteKit server: sync, history, pages, exports, /img, webhook
```

| Package                | Job                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine`      | All rules logic. It takes a `CardLookup` and does no I/O: it must not import `fs`, `net` or `child_process`, and ESLint enforces this.              |
| `packages/carddata`    | Downloads MTGJSON, checks it, caches it, builds the derived format tables and implements `CardLookup` with `better-sqlite3`.                        |
| `packages/repo`        | Reads a deck repo: git commands, scan and limits, format resolution, and which decks a set of changed files affects. The app and the validator share it. |
| `packages/validator`   | The CLI (`tcg-gauntlet-validate`), its Docker image, and the Action in `actions/validate`.                                                          |
| `packages/app`         | The SvelteKit app with `adapter-node`. It has its own tsconfig and is not part of `tsc -b`.                                                         |
| `packages/conformance` | The runner for the conformance corpus and its fixtures support. The cases are in `conformance/`.                                                    |
| `spec/`                | The normative specifications and JSON Schemas.                                                                                                      |
| `presets/`             | The formats that ship with the tool. A released file never changes.                                                                                 |

Rules that the code keeps:

- Every query against MTGJSON tables is in `packages/carddata/src/mtgjson-queries.ts`. No other file has SQL against MTGJSON tables. A schema change in a new MTGJSON release then breaks one file, and a self-check at startup reports it.
- MTGJSON stores a false flag as NULL, so every flag test is written `COALESCE(<flag>, 0)`.
- The structural rules for the three YAML inputs come from the JSON Schemas in `spec/schemas/`. They are compiled into the engine at build time (`packages/engine/src/generated`), and CI regenerates them and fails on any difference.

## The engine

The engine has five parts. Each keeps source line numbers so that a problem can point at a line.

1. **Parsing.** Deck files (front matter and list), `gauntlet.yaml` and format definitions. YAML is parsed as YAML 1.2 with aliases refused.
2. **Resolution.** Each deck line becomes a card and a printing. A set code on the line chooses the printing. Without one the card's default printing is used.
3. **Validation.** A list of violations. Each has a stable code, a severity, a file, a line and a message.
4. **Diff.** Compares two parsed decks by section and card name, and reports added, removed, count-changed and printing-changed entries.
5. **Exports.** MTGO `.txt`, `.dec` and MTGA text from a resolved deck.

The engine reaches card data only through `CardLookup`:

| Method                                     | Use                                                      |
| ------------------------------------------ | -------------------------------------------------------- |
| `findCard(name)`                           | Normalised name match. A double-faced card matches by its front face. |
| `findPrinting(set, number?, name?)`        | The printing a deck line names.                          |
| `inPool(formatKey, card)`                  | Whether a card is in a custom format's pool.             |
| `officialLegality(format, card)`           | `legal`, `restricted` or `not_legal` for an official format. |
| `defaultPrinting(formatKey, card)`         | The printing to show when a line has none.               |
| `arenaPrinting(card)`                      | A printing that is on Arena, for the MTGA export.        |
| `suggest(name, limit)`                     | Close names for "did you mean".                          |
| `dataVersion()`                            | MTGJSON version, date and SHA-256.                       |

The exact types are in `packages/engine/src/types.ts`.

### Format keys

Every format has a key, `<ref>#<hash12>` for a custom format and `<ref>#mtgjson` for an official one. The hash is made from the RFC 8785 canonical JSON of the definition. The rules are in [spec/format-definition.md](../spec/format-definition.md#format-keys), and [format-authoring.md](format-authoring.md#format-keys) has a worked example. Keys are used only as values in tables, never as file names or SQL identifiers.

### Conformance corpus

`conformance/cases/<name>/` holds a deck, the verdicts that a checker must report, and optionally the exact export text. The runner in `packages/conformance` runs every case against two lookups: an in-memory one built from `fixtures/cards.json`, and the SQLite lookup over `fixtures/mini-allprintings.sqlite`. The engine, the validator and the app are all tested against the same cases. Files in `conformance/` are byte-exact, so editors and formatters must not change them. See [conformance/README.md](../conformance/README.md).

## Card data (`carddata`)

The cache is in `<data dir>/`:

| Path                                          | Content                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `mtgjson/current.json`                        | The current and previous versions: version, date, SHA-256, path.       |
| `mtgjson/<version>-<date>/AllPrintings.sqlite` | The unpacked MTGJSON file. `+` in the version becomes `_` in the folder name. |
| `derived/<version>-<date>.sqlite`             | The derived tables for that MTGJSON version.                           |
| `tmp/`                                        | Downloads in progress.                                                 |

**Refresh.** The app does this at startup and every `MTGJSON_REFRESH_HOURS` hours. The validator does it on every run.

1. Fetch `Meta.json`. If the version and date match the current entry, stop.
2. Download `AllPrintings.sqlite.gz`, unpack it, and compute the SHA-256.
3. Open the file read-only and run the self-check: the expected tables and columns exist, and the card count is above a minimum.
4. Build the derived file for every format key in use.
5. Write `current.json` in one atomic step (temporary file, then rename). Keep the previous version and delete older ones.
6. If a step fails, the current version stays in use. The app shows the error in `/status`, and the validator reports `W-STALE-DATA`.

**Derived tables.** The derived file is the main SQLite connection, and the MTGJSON file is attached read-only, so one query can join both.

| Table            | Content                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `formats`        | Which format keys have been built.                                                                |
| `card_names`     | Every normalised name spelling mapped to the MTGJSON name. Filled by the engine's `normalizeName()`, because NFKD cannot run in SQL. |
| `card_names_fts` | An FTS5 trigram index over the normalised names, for `suggest()`.                                 |
| `card_meta`      | Per card: supertypes, layout and whether copy limits apply.                                       |
| `format_pool`    | The names that are in a custom format's pool.                                                     |
| `default_printing` | The default printing of each card, for each format key.                                         |
| `meta`           | Key and value pairs for the file itself.                                                          |

Building a format is a few `INSERT ... SELECT` statements in one transaction. A key that is already built is skipped.

**Default printing.** For a line without a set code, a printing qualifies when it is a paper, English, front-face printing that is not online-only, funny or oversized, and not a promo unless the card has no other printing. For a custom format it must be in a listed set. The oldest qualifying printing wins, with ties broken by set type, collector number and `uuid`. The full rule is in [spec/deck-file.md](../spec/deck-file.md#printings) and the design.

## The repo package

`packages/repo` has four parts:

- **Git wrapper.** Clone, fetch, `ls-remote`, reset, the history log and a long-lived `git cat-file --batch`. Git runs through `execFile`, with no shell. The environment is fixed: `HOME=<DATA_DIR>/home`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_ALLOW_PROTOCOL=https`. Every call passes `-c core.hooksPath=/dev/null`, `-c protocol.file.allow=never`, `-c http.followRedirects=false` and `-c safe.directory=<repo dir>`. A clone uses `--no-recurse-submodules`. This stops a global config, a hook, a submodule or a redirect from changing where git connects or what it runs. Test mode (`ALLOW_INSECURE_TEST_REPO_URL`) widens the protocols and nothing else.
- **Scan.** Finds gauntlet folders, decks, primers and `formats/*.yaml`, and applies the limits of [spec/gauntlet.md](../spec/gauntlet.md#limits).
- **Format resolution.** Turns a `format` value into a definition and a key.
- **Affected decks.** Works out which decks a list of changed files affects. The validator uses it for `--changed-since`.

## The validator

`tcg-gauntlet-validate` is a CLI over the engine, `carddata` and `repo`:

```text
tcg-gauntlet-validate [validate] [--repo <dir>] [--data-dir <dir>]
                      (--changed-since <git-ref> | --all)
                      [--output text|json|github] [--presets-dir <dir>]
tcg-gauntlet-validate init [--repo <dir>] [--format <ref>]
```

Exit code 0 means no errors, 1 means errors were found, and 2 means no usable card data or a usage error. `init` copies the bundled template (the `template/` folder, copied into the package at build time) into a folder and never overwrites a file.

The Docker image (`packages/validator/Dockerfile`) has the CLI, git, and the presets. The Action (`actions/validate/action.yml`) is a composite Action. It picks a comparison base, restores the card-data cache with `actions/cache`, runs the image as the runner's user, and saves the cache. The release workflow writes the image's exact digest into the Action, so the Action does not depend on tags.

## The app

The app is a SvelteKit server with `adapter-node`. A server hook (`src/hooks.server.ts`) starts one background sync loop. Every request reads from one in-memory, read-only **snapshot**: the scanned file contents, the parsed, resolved and validated decks, and the data for display. A snapshot never reads the working tree after it is built.

### The sync loop

`src/lib/server/sync.ts`. There is a single-flight lock. A trigger that arrives during a sync is remembered, and one more sync runs afterwards.

1. **Trigger.** Startup, a poll, or a webhook. The wait before a poll is `POLL_INTERVAL_SECONDS`, varied by up to 10% either way. A poll runs `git ls-remote` for the branch and stops when the SHA is the snapshot's commit.
2. **Fetch.** Clone on the first run, otherwise fetch the branch and `git reset --hard` to the remote SHA. A damaged clone is deleted and cloned again. On a cold start the MTGJSON refresh runs at the same time as the clone.
3. **Scan.** Reads every file into memory, with the limits applied. After this step `git reset` cannot change what the snapshot shows.
4. **Formats.** Resolves each gauntlet's format and builds the missing derived tables. This finishes before the swap, so a new format delays an update but never shows a half-built page.
5. **History.** Updates `history.sqlite`.
6. **Snapshot.** Parses, resolves and validates every deck. An error in one deck or gauntlet stays on that item.
7. **Swap.** Replaces the snapshot reference and records the commit, time and duration.

Failure rules:

- A sync that fails before the swap leaves the previous snapshot in use and records the error.
- A sync that runs because a trigger came in during another sync uses the latest remote SHA, not the SHA of the trigger.
- After a failure the next try waits 30 seconds, then 60, 120 and so on up to 10 minutes. A success resets the wait. This also applies to polling when GitHub answers 429 or 5xx.
- After 3 failures in a row every page shows a banner, "Content may be out of date since <time>".
- `/readyz` stays 200 while any snapshot exists.
- When MTGJSON has a new version, the app rebuilds the snapshot for the same commit under the same lock, and closes the old lookup after 60 seconds.
- On shutdown the loop waits up to 25 seconds for a running sync.

### History

`history.sqlite` holds the list of versions of each deck. It does not depend on MTGJSON, so an MTGJSON update never invalidates it. File contents stay in git: the app reads a version through one `git cat-file --batch` process, and keeps parsed versions in an LRU cache of 500 entries.

| Table           | Content                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sync_state`    | `last_commit` and `last_seq`.                                                                                        |
| `decks`         | `deck_id` and `current_path` (the deck path without extension, NULL once deleted).                                   |
| `deck_versions` | One row per deck, `seq` and kind (`txt` or `md`): status A, M, D or R, commit, blob, path at the commit, author, dates and subject. |

One pass fills it, for a full rebuild and an incremental update alike:

```text
git log --first-parent --reverse -z --no-abbrev --raw -M ... <range> -- '*.txt' '*.md'
```

- `HEAD` is resolved to a SHA once. The range is that SHA for a full rebuild and `last_commit..SHA` for an incremental update.
- `--first-parent` makes each pull-request merge on the branch one version, with the author and date of the merge commit.
- A deck is its `.txt` file. A rename keeps the `deck_id`. A delete ends the deck, and a later add at the same path is a new deck. A primer `.md` attaches to the live deck at its path.
- A rename plus a large edit (git's 50% similarity) is seen as a delete and an add, so it starts a new history.
- A full rebuild runs on the first start, after a force-push (`last_commit` is not an ancestor of the new head), or when the file is missing or damaged. It is written to a temporary file and renamed into place.

[Spike 4](spikes/git-history-cost.md) measured 0.25 s for a full rebuild of 100 decks and 3,000 commits, and 0.06 s for an incremental update, so history runs inside the sync.

### Routes

| Route                                       | Purpose                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `/`                                         | Lists the gauntlets.                                                          |
| `/g/<gauntlet>`                             | A gauntlet: description, decks, legality badges.                              |
| `/g/<gauntlet>/<deck>`                      | A deck: cards by type, primer, legality, exports.                             |
| `/g/<gauntlet>/<deck>/history`              | The version list, with pickers to compare two versions.                       |
| `/g/<gauntlet>/<deck>/v/<commit>`           | The deck at a commit. `?compare=<commit>` shows the diff. 404 unless the commit is a version of that deck. |
| `/g/<gauntlet>/<deck>/export/{mtgo,dec}`    | A download.                                                                   |
| `/g/<gauntlet>/<deck>/export/mtga`          | A page with the MTGA text and a copy button.                                  |
| `/g/<gauntlet>/<deck>/proxies`              | The browser builds a PDF of the cards with pdf-lib.                           |
| `/img/<scryfallId>/<front\|back>`           | The image route, for the PDF builder only.                                    |
| `/webhook/github`                           | Checks the HMAC and triggers a sync.                                          |
| `/healthz`, `/readyz`, `/status`            | Liveness, readiness, and a JSON status. See [hosting.md](hosting.md#operations). |

The image route answers 404 unless the ID belongs to a printing in the current snapshot, and `back` only for cards with a back face. It fetches from `cards.scryfall.io` only, follows no redirects, runs at most 4 fetches at once, and keeps a size-limited disk cache in `DATA_DIR/images`. It allows 120 requests a minute for each client address and answers 429 above that. Pages load their card images straight from `cards.scryfall.io`.

The webhook reads only the event header and `ref`. It answers 404 without a secret, 401 for a wrong signature, 202 for an accepted or ignored delivery, and 429 when the previous trigger was less than 5 seconds ago.

### Security

- The deck repo is trusted by the host but rendered as untrusted content. Markdown goes through markdown-it with `html: false`, links limited to http(s) and `mailto:`, and no images.
- A content security policy is set in `packages/app/vite.config.ts` with `mode: "auto"`, which adds nonces to inline scripts. Card images are allowed from `https://cards.scryfall.io`. Frames and objects are not allowed.
- Limits apply to every file read (see [spec/gauntlet.md](../spec/gauntlet.md#limits)). The card-line grammar uses anchored patterns without nested quantifiers, so matching time grows linearly with line length.
- `DECK_REPO_URL` must match the grammar in [spec/gauntlet.md](../spec/gauntlet.md#deck-repo-url-grammar). No user info, query or extra path is accepted.
- The container runs as the non-root user `node`. Every write goes to `DATA_DIR`, except SQLite's temporary files.
- Deck repo CI runs on `pull_request`, never `pull_request_target`, with `contents: read` and no secrets.

## Releases

A git tag `vMAJOR.MINOR.PATCH` starts `.github/workflows/release.yml`. It builds and pushes two images, `ghcr.io/flippyboy/tcg-gauntlet` and `ghcr.io/flippyboy/tcg-gauntlet-validator`, for `linux/amd64` and `linux/arm64`. Each gets the tags `vX.Y.Z`, `vX.Y` and `vX`, and `latest` for a tag that is not a pre-release. The workflow then writes the validator image digest into `actions/validate/action.yml`, writes the major version into `template/.github/workflows/validate.yml`, commits that, and moves the tags onto the commit. The Action is used as `flippyboy/tcg-gauntlet/actions/validate@v1`.

A breaking change to the engine, a schema or an error code is a new major version. `gauntlet.yaml`, format definitions and deck front matter each have an integer `schema_version`. A file with a version that the tool does not know is an error for its whole gauntlet. See [spec/README.md](../spec/README.md#schema-versions).

## Working on the code

You need Node 22 (see `.node-version`) and pnpm (the version is in `package.json`).

```sh
pnpm install
pnpm typecheck && pnpm build && pnpm lint && pnpm format && pnpm test
```

| Command           | What it does                                                            |
| ----------------- | ----------------------------------------------------------------------- |
| `pnpm build`      | Builds every package.                                                   |
| `pnpm typecheck`  | `tsc -b`, then `svelte-check` for the app.                              |
| `pnpm lint`       | ESLint with type-checked rules and the engine's no-I/O import rule.     |
| `pnpm format`     | Prettier in check mode.                                                 |
| `pnpm test`       | Builds, then runs vitest for every package, with coverage.              |
| `pnpm --filter @tcg-gauntlet/app e2e` | The Playwright smoke tests against the app image (see `packages/app/e2e`). |

CI (`.github/workflows/ci.yml`) also regenerates the engine's schema validators and fails on a difference, builds both images, validates `template/` with the validator image, times a cold and a warm validator run, and runs the end-to-end suite. A daily workflow (`mtgjson-canary.yml`) checks that the newest MTGJSON release still works with the queries and the conformance corpus.
