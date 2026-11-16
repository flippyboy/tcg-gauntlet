# TCG Gauntlet: Git-backed MTG Deck Gauntlet Viewer

*   **Author:** Filip Jansson
*   **Status:** Proposed
*   **Date:** 2026-11-15

--------------------------------------------------------------------------------

## Overview

TCG Gauntlet is a self-hosted web app plus a CI validator for Magic: The Gathering deck *gauntlets*. A gauntlet is a group of decks in one format, meant to be played against each other for playtesting.

The first target format is [2015 Modern](https://www.2015modern.com/), a community format. It allows the core sets and expansions from Eighth Edition (8ED) to Magic Origins (ORI), plus Time Spiral "Timeshifted" (TSB), with the Modern banlist as of January 2015.

The project starts from scratch: no code exists yet.

Two external data services are used:

*   **[MTGJSON](https://mtgjson.com/)** publishes free, downloadable Magic card data, including a ready-made SQLite database of every printing. It is the card data source.
*   **[Scryfall](https://scryfall.com/)** is a card search site whose image servers (`cards.scryfall.io`) host the card images.

All content lives in a separate, public GitHub repository, the *deck repo*.

*   **Layout:** each top-level folder that contains a `gauntlet.yaml` file is one gauntlet. It holds that file and one `.txt` file per deck.
*   **Editing:** people edit decks through pull requests.
*   **Validation:** a validator from this project runs in the deck repo's CI. It blocks merges that add illegal decks.

The web app has no authoritative database. It keeps SQLite caches that can be rebuilt from git and the published MTGJSON data. Its inputs are:

*   a clone of the deck repo
*   cached card data from MTGJSON
*   a *derived index*: SQLite tables, built from the card data and the format definitions, that list which cards are legal in each custom format and which printing to show by default

From these, it shows:

*   visual decklists with card images and primers
*   the version history of each deck
*   exports
*   a proxy-print PDF
*   links for proposing changes on GitHub

This repo produces three deliverables from one TypeScript codebase:

1.  **App image.** Hosts run it with Docker Compose or Kubernetes, configured only through environment variables.
2.  **Validator image and GitHub Action.** Deck repos use them in CI.
3.  **Format-definition schema and versioned presets.** These cover formats that official legality data cannot describe, such as `preset:2015-modern@1`.

## The Problem

A playgroup that keeps a gauntlet has these needs today, and no single tool covers all of them:

*   **Shared editing with history.** Several people maintain the same set of decks. They want review before a change lands, a record of who changed what, and the ability to see how a deck looked last month.
    *   Deck sites such as [Moxfield](https://moxfield.com/) and [Archidekt](https://archidekt.com/) have single-owner decks, limited collaboration, and no review step (as checked by the author in November 2026).
    *   A shared folder or spreadsheet has no structure, and does not show card-level changes.
*   **Legality for non-official formats.** 2015 Modern is frozen at the Magic Origins card pool and the January 2015 Modern banlist.
    *   Scryfall and MTGJSON only publish *current* official legality. Their "Modern" legality therefore answers a different question than 2015 Modern asks.
    *   Community validators, such as [badaro's web validator](https://badaro.github.io/validator/), check one pasted list at a time. The author found none that can run in a review step (November 2026).
*   **Viewing a gauntlet as a set.** Players want to browse every deck in a gauntlet, read its primer, and take it into a client or onto paper.
    *   Taking a deck into a client means one of these: Magic: The Gathering Online (MTGO), MTG Arena (MTGA, also called Arena), or the free clients Cockatrice and Forge.
    *   Taking a deck onto paper means printing proxies, which are stand-in cards printed on paper for playtesting.
    *   [mtgtop8](https://www.mtgtop8.com/) offers exports for tournament decks, but not for a group's own curated lists.

**Proposed solution.** Treat git as the database and the review tool.

*   The deck repo holds plain-text decklists that any git-literate person can edit.
*   A CI validator gives each pull request a pass or fail result, with line-level errors.
*   A self-hosted app turns the repo's tracked branch into a browsable site within the G6 targets (45 s by polling, 10 s with a webhook). It holds nothing that can't be rebuilt from git and the currently published card data.
*   One rules engine runs in both CI and the app, so the two give the same verdict for the same inputs (G4).

## Goals

*   **G1 — Git is the only way to edit content.**
    *   All deck, gauntlet and custom-format content comes from one public GitHub deck repo, from one configured branch (default `main`).
    *   The app has no write path. Its "Edit on GitHub" and "New deck on GitHub" links open GitHub.
*   **G2 — Repo layout and file formats.**
    *   Each top-level folder with a `gauntlet.yaml` is a gauntlet.
    *   Decks are `<name>.txt` files. Each file has optional YAML front matter and an Arena-style list with optional set codes and collector numbers.
    *   Optional `<name>.md` and `gauntlet.md` files hold primers and descriptions.
    *   Custom formats live in `formats/*.yaml`.
    *   Each format has a written spec and a JSON Schema in this repo.
*   **G3 — Legality and checking.**
    *   *Official formats* work with no definition file, using MTGJSON legalities.
    *   *Custom formats* use format-definition schema v1. It checks legality by card name and supports an explicit set list, a banned list, a restricted list (cards allowed at most once), and deck-size and copy limits.
    *   `preset:2015-modern@1` ships in v1. It matches 2015modern.com's legal sets and banned list. Spike 2 verified the match: 9,186 legal names, zero differences.
    *   **Acceptance criteria for the preset:**
        *   Spike 2 finds zero unexplained differences against the site's card search. Every remaining difference is recorded as an `include` or `exclude` entry with a `reason`.
        *   The conformance corpus passes:
            *   legal Jund, Affinity and Burn decks
            *   decks containing Treasure Cruise, Cloudpost or a card printed after ORI, each of which must fail
            *   a deck containing Golgari Grave-Troll, which must pass
*   **G4 — Same verdict everywhere.**
    *   The validator and the app give the same verdict and the same error codes for the same deck, format definition and MTGJSON version.
    *   Both show the engine version, the format key and the MTGJSON version they used. The deck page's legality badge says "checked against MTGJSON <version>".
    *   CI and the app may use different MTGJSON versions for up to one refresh interval:
        *   Frozen custom formats are not affected, because their pool comes from an explicit set list.
        *   Official formats can change verdict when Wizards of the Coast changes legality.
*   **G5 — CI blocks illegal changes.**
    *   The validator runs as a GitHub Action in the deck repo. It checks:
        *   every changed deck
        *   every deck affected by a changed `gauntlet.yaml`, `gauntlet.md` or format file
    *   It fails the check on any violation. Errors give file, line and rule as GitHub annotations.
    *   Infrastructure errors use a separate exit code from rule violations.
    *   Target with a warm card-data cache: under 60 seconds per run.
    *   Target with a cold cache: under 5 minutes. On a cache miss the validator downloads the data and is slower, but never gives a different verdict.
    *   Both targets are checked in spike 1. Its threshold and fallback are listed in Open Questions.
*   **G6 — Fresh content.**
    *   The default poll interval is 30 seconds.
    *   Target: a push to the tracked branch shows in the app within 45 seconds by polling, or within 10 seconds when a GitHub webhook is set up.
*   **G7 — Viewing features.** For each deck:
    *   A visual decklist grouped by card type, with card image previews.
    *   Metadata and the inline primer.
    *   "Date updated" taken from git.
    *   A legality badge: legal or illegal, with the list of violations and the MTGJSON version used.
*   **G8 — History features.**
    *   A list of the previous versions of each deck. One version is one commit or merge on the tracked branch (first-parent history).
    *   The full list as of any version.
    *   A per-card diff between versions: added, removed, count changed and printing changed.
*   **G9 — Output features.**
    *   Exports in mtgtop8's three layouts:
        *   MTGO `.txt`: count and card name per line, then the sideboard.
        *   `.dec`: the same, with `SB:` before each sideboard line.
        *   MTGA: Arena's import text, with set codes.

        The MTGA export warns about cards that are not on Arena. The layouts follow the mtgtop8 samples captured in spike 3 (item 36).
    *   A proxy-print PDF: nine cards per page at 63×88 mm, on A4 or Letter paper.
*   **G10 — Easy hosting.**
    *   One upstream image, with one replica and one disk volume.
    *   No card data baked into the image.
    *   A cold start with an empty volume becomes ready with no manual steps.
    *   `/readyz` and `/status` show the sync state and the data versions. `/healthz` shows that the process is alive.
*   **G11 — Reusable for other deck repos.**
    *   A template deck repo, a CI workflow and a branch-protection guide let anyone start a new deck repo that follows the same rules.

## Non-Goals

*   **Hosts other than GitHub.** No GitLab, Gitea, Bitbucket, or private repos in v1.
*   **More than one repo or replica.** No instance that serves several deck repos, and no multi-replica deployment.
*   **Static hosting.** No GitHub Pages, and no hosting option that needs CI on the hoster's side.
*   **Printing-based legality.** No legality by printing, and no Swedish Old School preset. Schema field `legality_by` is the planned extension point.
*   **Editing or accounts in the app.** No user accounts, in-app deck editing, likes, or comments.
*   **Play features.** No matchup tracking, pairings, match results, or win rates. The gauntlet is shown, not played.
*   **Hidden state.** No database of record. Every file on disk is a cache that can be rebuilt from the deck repo and the currently published MTGJSON release.
*   **Image mirroring.** No mirroring of card images for page display. Only the PDF uses a bounded, server-side image cache.
*   **Programmable rules.** No rule expression language, and no code written for one specific format.
*   **Historical legality.** No legality "as of" an old commit. Every verdict is computed against the current data.
*   **Shared decks.** No deck shared between gauntlets by reference. A deck that belongs to two gauntlets is copied, and each copy has its own history and "date updated".
*   **Foreign-language support.** No card names or UI text in other languages.

## Open Questions

Each spike below has a threshold. If a spike misses its threshold, the design switches to the named fallback. Some fallbacks change the architecture:

* **Spike 1's fallback** would have added a card-data file published by this repo. Spike 1 passed, so the fallback is not used.
* **Spike 5's outcome** could have removed the `/img` route. The author decided to keep it.

All five spikes ran on 2026-11-15. Their findings are in `docs/spikes/`. The results are below. No decision in the Technical Plan is provisional any more.

*   **Spike 1: MTGJSON size and archives.**
    *   **Question.** How large is `AllPrintings.sqlite.gz`? How long do the download, the unpacking and the derived-index build take on a GitHub runner and on a 2-vCPU host? What are the peak memory, including the SQLite page cache, and the disk use? Does MTGJSON's file server (`https://mtgjson.com/api/v5/`) keep older versions?
    *   **Go.** A cold CI run takes 5 minutes or less, and the unpacked file is 1.5 GB or less.
    *   **Fallback.** A scheduled workflow in this repo publishes a slim, versioned card-data file, and CI and cold starts fetch that file instead.
    *   **If old versions are not kept,** repeatable verdicts rest only on the format definitions. The design already plans for that.
    *   **Result: GO.** See `docs/spikes/mtgjson-size.md`.
        *   **Size:** `AllPrintings.sqlite.gz` is 227 MB and unpacks to 0.72 GB.
        *   **Time:** download plus unpack takes about 7 s on a developer machine. A cold CI run is estimated at 15–40 s on a GitHub runner.
        *   **Derived build:** about 1.3 s, producing a 12.5 MB file, with a peak resident memory of about 128 MiB.
        *   **Checksums:** MTGJSON publishes `.sha256` files for both the `.gz` and the unpacked file.
        *   **Old versions:** none are kept.
        *   **Names:** the table names assumed in this design are correct.
        *   **Volume:** at least 4 GiB for card data, and 5 GiB including history and images.
*   **Spike 2: 2015 Modern pool check.** Does a pool built from MTGJSON for the preset's set list, minus the January 2015 banlist, match 2015modern.com's card search? The acceptance criteria are in G3. **Result: met.** Both pools have 9,186 names and there are zero differences. TSB is an `expansion` set in both MTGJSON and Scryfall, and leaving it out would drop 119 cards. All 32 banned names match exactly, and Golgari Grave-Troll is in the pool. See `docs/spikes/modern-2015-pool.md`.
*   **Spike 3: mtgtop8 export format.** What is the exact layout of mtgtop8's MTGO, `.dec` and MTGA exports, including sideboard markers, line endings and set codes? Samples are captured as test fixtures. **Result: done.** All three layouts differ from the first draft, and items 16 and 36 now follow the samples. See `docs/spikes/mtgtop8-exports.md`.
*   **Spike 4: history cost.**
    *   **Question.** How long does the history pass (see History) take for 100 decks and 3,000 commits, both as a full rebuild and as an incremental update after a 10-file push? This spike measures cost. It does not reopen the decision to compute history during sync.
    *   **Go.** A full rebuild takes 60 seconds or less, and an incremental update takes 2 seconds or less.
    *   **Fallback.** History leaves the sync critical path and becomes a background stage with its own `building`/`ready` state. `/readyz` then waits only for the deck snapshot, and history pages show "history is updating" until the stage is ready.
    *   **Result: GO.** See `docs/spikes/git-history-cost.md`.
        *   **Timing:** a full rebuild takes 253 ms and an incremental update takes 59 ms.
        *   **Blob reads:** reading 500 blobs takes 6.5 ms through `cat-file --batch`, against 897 ms with separate processes.
        *   **Correctness:** all 14 checks pass, including incremental updates matching a full rebuild row for row.
        *   **Corrections:** the spike's corrections to the history rules are applied in the History section.
*   **Spike 5: Scryfall policy and CORS.**
    *   **Question.** Does Scryfall's current API documentation confirm the image-use statements this design relies on? Does `cards.scryfall.io` send CORS headers that allow the browser to `fetch()` images?
    *   **If it does,** the `/img` route and the image cache can be removed.
    *   **Result: CORS is allowed.** See `docs/spikes/scryfall-policy-cors.md`.
        *   **CORS headers:** `cards.scryfall.io` sends `Access-Control-Allow-Origin: *` on images and on the preflight, so a cross-origin `fetch()` is expected to work. No browser test was run.
        *   **URL pattern:** confirmed. Back faces use the same id as the front.
        *   **Policy wording:** not yet verified, because the docs pages refuse automated fetches. The author reads them in a browser.
        *   **Decision (author, 2026-11-15): keep `/img`.** The PDF keeps working if Scryfall changes its CORS headers, and the server keeps its own cached copies.
*   **License and GitHub owner (decided).** MIT License. The repo is published as `github.com/flippyboy/tcg-gauntlet`, with images at `ghcr.io/flippyboy/tcg-gauntlet` and `ghcr.io/flippyboy/tcg-gauntlet-validator`.

## Critical User Journeys (CUJs)

### CUJ 1: Host a gauntlet site

*   **Given**: A host has Docker, and a public GitHub deck repo exists with at least one gauntlet folder.
*   **When**: They run the upstream image with `DECK_REPO_URL` (and optionally `DECK_REPO_BRANCH`, `WEBHOOK_SECRET`) and a volume mounted at the data directory.
*   **Then**:
    *   The app clones the repo, downloads MTGJSON data and builds the derived index.
    *   `/readyz` turns ready.
    *   The home page lists every gauntlet with its name, format and deck count.
    *   The footer shows the commit, the MTGJSON version and the engine version.

### CUJ 2: Propose and merge a deck change

*   **Given**: A collaborator wants to swap two cards in a 2015 Modern deck, and the deck repo uses the template CI with branch protection turned on.
*   **When**: They click "Edit on GitHub" on the deck page, change the `.txt` file, and open a pull request.
*   **Then**:
    *   The validator check runs on the pull request.
    *   If the change adds a banned card or a card outside 8ED–ORI, the check fails with an annotation on the offending line, for example "E-LEGAL-BANNED: Treasure Cruise is banned in 2015 Modern". The merge is blocked.
    *   Once the check passes and the PR is merged, the deck page shows the new list within 45 seconds, or within 10 seconds with a webhook.

### CUJ 3: Review what changed

*   **Given**: A deck has had several merged changes.
*   **When**: A player opens the deck's history and picks two versions.
*   **Then**:
    *   They see the commit list, with date, author and message.
    *   They see the full list at the chosen version.
    *   They see a per-card diff, for example `+2 Kolaghan's Command`, `−1 Maelstrom Pulse`, and `Tarmogoyf: FUT → MMA`.

### CUJ 4: Take a gauntlet to the table

*   **Given**: A player wants to playtest against a gauntlet deck.
*   **When**: They open the deck and choose an export or "Print proxies".
*   **Then**:
    *   They get an MTGO `.txt` or `.dec` file in mtgtop8's layout, for import into MTGO or Cockatrice. Spike 3 matched the layouts, but import into the clients themselves has not been tested. Or they get an MTGA list with a warning about cards that are not on Arena.
    *   Or they get a PDF of the deck's main deck and sideboard at 63×88 mm, nine per page.

### CUJ 5: Start a new deck repo

*   **Given**: Someone wants their own gauntlet repo using 2015 Modern or a custom format.
*   **When**: In an empty git repo, they run `docker run --rm -v "$PWD:/w" -w /w ghcr.io/flippyboy/tcg-gauntlet-validator:v1 init`. They then edit `gauntlet.yaml`, add decks, push to GitHub, and turn on branch protection as the guide describes.
*   **Then**:
    *   CI checks their decks with the same rules as the app.
    *   They can point an app instance at the repo with one environment variable.

## Technical Plan (Architecture)

### Architecture decisions (chosen by author)

| Decision | Choice |
|---|---|
| Web framework | SvelteKit with the Node adapter. Pages are rendered on the server, and Svelte components handle the interactive parts. |
| Card data access | The app opens MTGJSON's `AllPrintings.sqlite` read-only and queries it directly. A derived SQLite file is attached to it and holds per-format tables. |
| Version history | The version list and the parsed version of each deck are computed during sync and stored in `history.sqlite`. Diffs between two versions are computed on request from two stored parsed versions. |
| Card images | Pages load images straight from `cards.scryfall.io`. The PDF builder fetches them through an app route that has a size-limited disk cache. |

The stack below follows from those choices. Alternatives such as Node's built-in `node:sqlite` were not evaluated.

* TypeScript on Node.js 22 LTS.
* A pnpm workspace.
* `better-sqlite3` for SQLite access.
* The system `git` binary, run through `execFile` with no shell.
* pdf-lib in the browser.
* markdown-it with raw HTML turned off.
* The `yaml` library in YAML 1.2 mode with aliases turned off.
* vitest for tests.

### Components

```text
                       ┌──────────────────────── this repo (monorepo) ────────────────────────┐
                       │                                                                        │
                       │  spec/  presets/  conformance/                                         │
                       │     │       │          │                                               │
                       │     ▼       ▼          ▼                                               │
                       │  ┌──────────────────────────┐                                          │
                       │  │ packages/engine (pure TS) │  parse · resolve · validate · diff ·     │
                       │  │  no I/O, takes CardLookup │  export                                  │
                       │  └────────────┬─────────────┘                                          │
                       │               │ CardLookup interface                                   │
                       │  ┌────────────▼─────────────┐                                          │
                       │  │ packages/carddata         │  MTGJSON download · checksum · cache ·   │
                       │  │  better-sqlite3           │  derived format tables · CardLookup impl │
                       │  └──────┬─────────────┬─────┘                                          │
                       │         │             │                                                │
                       │  ┌──────────────────────────┐                                          │
                       │  │ packages/repo             │  git wrapper · repo scan · limits ·      │
                       │  │  (shared by both below)   │  format resolution · affected decks      │
                       │  └──────┬─────────────┬─────┘                                          │
                       │  ┌──────▼──────┐ ┌────▼────────────────────────────┐                   │
                       │  │ validator   │ │ app (SvelteKit, adapter-node)    │                   │
                       │  │ CLI + image │ │ sync loop · history · pages ·    │                   │
                       │  │ + GH Action │ │ exports · /img route · webhook   │                   │
                       │  └──────┬──────┘ └────┬─────────────────────────────┘                   │
                       └─────────┼─────────────┼────────────────────────────────────────────────┘
                                 │             │
             deck repo CI (PRs)  │             │  one container, one volume (DATA_DIR)
                                 ▼             ▼
   ┌───────────────┐   git fetch / ls-remote   ┌──────────────────────────┐
   │ GitHub deck   │◄──────────────────────────│ DATA_DIR/repo (full clone)│
   │ repo (public) │──── push webhook ────────►│ DATA_DIR/mtgjson/<v>-<d>/ │◄── mtgjson.com (Meta.json,
   └───────────────┘                           │ DATA_DIR/derived/*.sqlite │    AllPrintings.sqlite.gz)
                                               │ DATA_DIR/history.sqlite   │
                                               │ DATA_DIR/images/ (PDF)    │◄── cards.scryfall.io
                                               └──────────────────────────┘
   Browser ── HTML pages ──► app        Browser ── <img> ──► cards.scryfall.io (pages)
   Browser ── /img/<id> ───► app (PDF builder only)
```

#### `packages/engine`

This package holds all rules logic as pure functions. Its only dependency is the `CardLookup` interface. The app and the validator both import it, so both give the same verdicts. It has five parts:

* **Parsing.** It parses deck files (front matter and list), `gauntlet.yaml`, and format definitions. Each parse result keeps source line numbers so that errors can point at a line.
* **Resolution.** It turns each deck line into a card plus a printing. When a line has a set code, that printing is used. When it doesn't, the default printing for the deck's format is used.
* **Validation.** It returns a list of violations. Each violation has a stable code, a severity, the file, the line, a message, and a suggestion where one exists.
* **Diff.** It compares two parsed decks by (section, card name) and reports added, removed, count-changed and printing-changed entries.
* **Exports.** It produces MTGO `.txt`, `.dec` and MTGA output from a resolved deck.

The *conformance corpus* is a folder of test decks with expected verdicts and expected exports. It runs in this repo's CI against both an in-memory test card lookup and the real SQLite lookup, so the engine, the validator and the app are checked against the same cases.

#### `packages/repo`

This package holds the code that reads a deck repo. The validator and the app both need it, and sharing it stops them drifting apart. It has four parts:

* **Git wrapper.** Clone, fetch, `ls-remote`, reset, and history log, each run with the safety settings from Security.
* **Repo scan.** Finds gauntlet folders, deck files, sidecar `.md` files and `formats/*.yaml`, and applies the size and count limits.
* **Format resolution.** Turns a `gauntlet.yaml` `format` value into a format definition and key.
* **Affected decks.** Works out which decks a set of changed files affects. The validator uses it for `--changed-since`.

The interface the engine depends on (illustrative):

```ts
interface CardLookup {
  findCard(name: string): CardRef | NotFound;          // normalised name match, front face for DFCs
  findPrinting(set: string, number?: string, name?: string): PrintingRef | NotFound;
  inPool(formatKey: FormatKey, card: CardRef): boolean;   // custom formats; banned/restricted come from the definition
  officialLegality(format: string, card: CardRef): 'legal' | 'restricted' | 'not_legal';
  defaultPrinting(formatKey: FormatKey, card: CardRef): PrintingRef;
  arenaPrinting(card: CardRef): PrintingRef | NotFound;   // for the MTGA export
  suggest(name: string, limit: number): string[];      // for "did you mean"
  dataVersion(): { mtgjsonVersion: string; mtgjsonDate: string; sha256: string };
}
```

#### `packages/carddata`

This package downloads MTGJSON, checks it, and caches it. It builds the derived format tables and implements `CardLookup` on top of SQLite.

Every query that names MTGJSON tables or columns lives in one module, `mtgjson-queries.ts`. A schema change in a new MTGJSON release then breaks only that module, and a startup self-check reports the break. Spike 1 confirmed the table names `cards` (one row per face), `sets`, `cardLegalities` (one column per format, with values `Legal`, `Banned`, `Restricted` or NULL) and `cardIdentifiers`. MTGJSON stores boolean flags as NULL when false, so every flag test is written `COALESCE(<flag>, 0)`.

**Refresh cycle.** This runs at startup and then every `MTGJSON_REFRESH_HOURS` hours (default 24):

1. Fetch `Meta.json`. If its version and date match the current cache entry, stop.
2. Download `AllPrintings.sqlite.gz` to a temporary file, unpack it, and compute its SHA-256.
3. Open the file read-only and run the self-check. The expected tables and columns must exist, and the card count must be above a minimum.
4. Build `derived/<version>-<date>.sqlite` for every format key in use, against the new file.
5. Change `mtgjson/current.json` (version, date, checksum, path) in one atomic step by writing a temporary file and renaming it. Keep the previous version on disk, and delete anything older.
6. If any step fails, the current version stays in use. The error appears in `/status` and in the logs.

**Derived format tables.** These live in `derived/<version>-<date>.sqlite`, next to the MTGJSON file at `mtgjson/<version>-<date>/AllPrintings.sqlite`.

The derived file is the main connection and is opened read-write. The MTGJSON file is attached read-only with `ATTACH 'file:…?mode=ro' AS mtg`, so one query can join the two. If MTGJSON were the main connection opened read-only, the attached derived file would be read-only too.

| Table | Columns | Purpose |
|---|---|---|
| `formats` | `format_key`, `built_at` | Records which formats have been built. |
| `card_names` | `norm_name`, `name`, `face_name` | Maps every normalised full name, face name and split-card spelling to the MTGJSON name. It is filled by the engine's `normalizeName()` because NFKD normalisation can't run in SQL. |
| `card_names_fts` | FTS5 trigram index over `norm_name` | Supports `suggest()` ("did you mean"). |
| `card_meta` | `name`, `supertypes`, `layout`, `copy_exempt` | Data the engine needs per card, including whether copy limits apply. |
| `format_pool` | `format_key`, `name` | Lists the cards legal by name in a custom format. Banned cards are excluded. Restricted cards are included. The table holds membership only: the engine reads the restricted list from the definition and allows at most 1 copy. Official formats have no rows here, because their legality comes from MTGJSON. |
| `default_printing` | `format_key`, `name`, `uuid` | Holds the default printing for each card, chosen by the rule in Default printing below. There is one row per format and card, for official formats too. |

* `format_key` is the normalised `format` reference from `gauntlet.yaml`, then `#`, then the first 12 hex characters of the SHA-256 of the definition's RFC 8785 canonical JSON. An example is `preset:2015-modern@1#3f9a01c2b7de`. The exact rules are in `spec/format-definition.md` (implementation item 18).
  * An official format has no definition file, so its key ends in the fixed suffix `#mtgjson`, for example `official:modern#mtgjson`. Its legality comes from MTGJSON.
  * Keys are stored only as row values, never as file names or SQL identifiers.
* Building a format is a few `INSERT … SELECT` statements in one transaction. A format key that is already present is skipped.
* A format key that no gauntlet uses any more is deleted at the next MTGJSON refresh.

**Name normalisation.** Names are matched after these steps:

* Unicode NFKD, with accents removed.
* Lower case.
* Curly quotes turned into straight quotes.
* Repeated whitespace collapsed.
* For split cards, `Fire // Ice`, `Fire/Ice` and `Fire / Ice` are accepted, with any spacing.
* For double-faced and adventure cards, the front-face name is accepted.

#### `packages/validator`

This is a CLI around the engine, `carddata` and `repo`. It ships as a Docker image published to GHCR, plus a composite GitHub Action that restores the card-data cache and then runs that image.

```text
tcg-gauntlet-validate [--repo <dir>] [--data-dir <dir>]
                      [--changed-since <git-ref> | --all]
                      [--output text|json|github]
tcg-gauntlet-validate init [--format <ref>]
exit 0 = no E- codes (warnings allowed) · 1 = E- codes found · 2 = no usable card data, or usage error
```

* **`init`** writes the bundled deck-repo template into the current folder. That is how a new deck repo starts, because GitHub's "Use this template" only works on a repository root, not on a folder inside this repo.
* **Stale data.** If the card-data refresh fails but cached data exists, the validator continues on the cached data and reports `W-STALE-DATA`.

* **What it checks with `--changed-since`:**
  * Every deck file that changed.
  * Every deck in a gauntlet whose `gauntlet.yaml` or `gauntlet.md` changed.
  * Every deck in every gauntlet that refers to a format file under `formats/` that changed.
  * Primer `.md` files are checked for size only.
* **In the Action:** the Action picks a comparison base:
  * On pull requests it uses the merge base with the target branch, and changed files come from `git diff <base>...HEAD`.
  * On pushes it uses `github.event.before`.
  * If there is no usable base, it validates everything with `--all`.

  It caches `--data-dir` with `actions/cache`. The cache key changes once a week, which only controls how often the cache is replaced. The validator itself compares the cached MTGJSON version with `Meta.json` and downloads again only when the version changed, so most runs are expected to download only `Meta.json`.
* **Output:** `--output github` writes error and warning annotations through `@actions/core`, and the full result table to the step summary.

#### `packages/app`

This is the SvelteKit app built with `adapter-node`. When the server starts, a hook starts one background sync loop. Every request reads from one in-memory, read-only **snapshot**.

A **snapshot** holds the scanned file contents, the parsed, resolved and validated decks, and the per-deck display data. It never reads the working tree after it is built.

**Sync loop.** It has a single-flight lock: if a trigger arrives while a sync is running, it is remembered, and one more sync runs afterwards.

1. **Trigger.** Startup, a poll every `POLL_INTERVAL_SECONDS` seconds (default 30), or a webhook call.
   * The poll runs `git ls-remote origin refs/heads/<branch>`. When the SHA matches the snapshot's commit, the cycle stops there.
2. **Fetch.** Run `git fetch origin <branch>`, then `git reset --hard FETCH_HEAD`.
   * The first run is a full `git clone --no-recurse-submodules`, with the git settings listed in Security.
   * If the clone is corrupt, the app deletes it and clones again.
3. **Scan.** List the gauntlet folders (top-level folders that contain `gauntlet.yaml`), their deck `.txt` files, the `.md` primers and descriptions, and `formats/*.yaml`.
   * Size and count limits apply here. An item over a limit becomes an error on its gauntlet.
4. **Formats.** Work out the format key for each gauntlet, and build any missing format tables.
   * This finishes before the snapshot is swapped. A new format delays the update by its build time, but never shows a half-built page. The build time is expected to be seconds and is measured in spike 1.
5. **History.** Update `history.sqlite` (see below).
6. **Build snapshot.** Parse, resolve and validate every deck through the engine. Group cards by type for display, and record the date-updated values from the history table.
   * An error in one deck or gauntlet is kept on that item and does not stop the sync.
7. **Swap.** Replace the snapshot reference in one step, and record the commit, time and duration in the status.
   * If anything fails before this step, the previous snapshot stays in use and the error goes to the status.

**Failure and concurrency rules.**

* **Safe reset.** Step 3 reads every file's contents into memory. So `git reset --hard` in a later sync can run while the old snapshot is still serving.
* **Latest commit wins.** A sync that runs again because a trigger arrived mid-sync fetches and uses the latest remote SHA, not the SHA from the trigger.
* **Retry.** A failed sync is retried with exponential backoff, from 30 seconds up to 10 minutes. The next success resets the backoff.
* **Staleness.** `/status` reports `stale_since`, which is the time of the first failure since the last success. After 3 failed syncs in a row, every page shows a banner: "Content may be out of date since <time>".
* **Readiness.** `/readyz` stays ready as long as any snapshot exists, because serving stale content is better than serving none.
* **Polling backoff.** On HTTP 429 or 5xx from GitHub, polling backs off the same way as a failed sync.

**History in `history.sqlite`.** History doesn't depend on MTGJSON. The version list is computed during sync and stored. The file contents themselves stay in git: they are read on request through one long-lived `git cat-file --batch` process, and the parsed versions are cached in memory with an LRU of 500 entries. An MTGJSON update therefore never invalidates history.

| Table | Columns | Keys |
|---|---|---|
| `sync_state` | `key`, `value`. Holds `last_commit` and `last_seq`. | primary key `key` |
| `decks` | `deck_id INTEGER`, `current_path TEXT` | primary key `deck_id`, unique `current_path` |
| `deck_versions` | `deck_id`, `seq`, `kind` (`txt` or `md`), `status` (A/M/D/R), `commit_sha`, `blob_sha` (NULL for D), `path_at_commit`, `author_name`, `author_date`, `author_ts`, `committer_date`, `subject` | primary key (`deck_id`, `seq`, `kind`), index on `commit_sha` |

* **One history pass.** A full rebuild and an incremental update run the same command over the tracked branch, so they produce identical rows:

  ```text
  git log --first-parent --reverse -z --no-abbrev --raw -M \
    --format=%x1e%H%x1f%an%x1f%aI%x1f%at%x1f%cI%x1f%s <range> -- '*.txt' '*.md'
  ```

  * **Range:** the pass resolves `HEAD` to a SHA once, `newHead`, at the start. `<range>` is then `newHead` for a full rebuild and `last_commit..newHead` for an incremental update, and `newHead` is stored as `last_commit`.
  * **Record format:**
    * **Header:** each commit record starts with `\x1e`. Its fields (`%H`, `%an`, `%aI`, `%cI`, `%s`) are separated by `\x1f`, and the header ends with a NUL.
      * The parser splits off the first four fields on `\x1f` and treats the rest as the subject, so a `\x1f` inside a subject does no harm.
    * **Entries:** a `\n` follows the header, then the `--raw -z` entries: `:<old mode> <new mode> <old sha> <new sha> <status>` NUL `<path>` NUL.
      * `R` entries carry a second path, followed by another NUL.
      * Nothing separates entries from each other, or one record from the next.
      * The status letter is the first character of the status field, so `R100` means `R`.
      * A deleted file has an all-zero new SHA, which is stored as NULL.
    * **Paths:** `-z` keeps paths with spaces or Unicode unquoted.
    * **Rename detection:** the command also passes `-c diff.renameLimit=0`, so git never falls back to reporting a delete and an add for a large rename.
  * **Which paths are kept:** only `<gauntlet>/<deck>.txt` and `<gauntlet>/<deck>.md` at the top level of a gauntlet folder. Every other path is skipped.
  * **Merges:** `--first-parent` makes each pull-request merge on the tracked branch count as one version. A merge version's author and `author_date` are the merge commit's own, which is the person who merged and the time of the merge. They are not taken from the feature branch. A squash merge carries the PR author.
  * **Deck identity:** a deck is its `.txt` file.
    * `decks.current_path` is the deck path without extension, `<gauntlet>/<deck>`. It is NULL once the deck is deleted, and the unique index allows many NULLs.
    * A `decks` row is created only by a `.txt` event.
  * **Boundary rule:** an `R` entry is kept as `R` only when both paths pass the path filter and have the same extension. Otherwise it is split into a `D` for the old path if that passes the filter, and an `A` for the new path if that passes the filter.
  * **Status rules:** applied per commit. `.txt` entries go first, then `.md`. Within a kind, `D` and `R` go before `A` and `M`.
    * **`.txt` `A`:** inserts a `decks` row and a version with status `A`. An `M` or `R` that has no live row is treated the same way.
    * **`.txt` `M`:** adds a version.
    * **`.txt` `R`:** adds a version with status `R`, and sets `current_path` to the new stem. The deck keeps its history across the rename.
    * **`.txt` `D`:** adds a version with a NULL blob, and sets `current_path` to NULL. A later `A` on the same path gets a new `deck_id`.
    * **`.md` events:** attach to the live deck at the stem of the new path. An `.md` event with no live deck at that stem is skipped, so a primer committed before its deck gets its first version on its next change.
    * **`.md` `R`:**
      * If the deck is already at the new stem, because its `.txt` moved in this or an earlier commit, the rename adds an `R` version.
      * If the primer moves away from a deck that stays behind, it adds a `D` for the old deck, and an `A` for the deck at the new stem if one exists.
  * **Known limits, accepted:**
    * A rename combined with an edit of more than about half of the file shows up as `D` and `A`, so it starts a new `deck_id`. This uses git's default 50% similarity.
    * When two decks have byte-identical content, a rename in the same commit can pair with the wrong one.
  * **`seq`:** a global counter that goes up by one for each first-parent commit that has at least one kept entry, in `--reverse` order. One version of a deck is one `seq`. Its `txt` and `md` rows share that `seq`. An incremental update continues from `last_seq + 1`, so a full rebuild and an incremental update assign the same values.
  * **Transactions:** an incremental update writes its rows, `last_commit` and `last_seq` in one transaction.
* **Incremental update.** This runs when `last_commit` exists and is an ancestor of the new HEAD.
* **Full rebuild.** This runs on the first start, after a force-push, or when the file is missing or corrupt.
  * A force-push is detected when `last_commit` is no longer an ancestor of HEAD, or is no longer present in the clone.
  * The app rebuilds into a temporary file and renames it into place, then reopens its handle. The old file keeps serving until the rename.
* **Dates.** `deck_versions` also stores `author_ts`, the `%at` integer timestamp. "Date updated" is the deck's newest `author_ts`. The `%aI` strings keep each author's timezone offset, so they don't sort in time order.
* **Pages.** History pages read `deck_versions` and fetch each version's content by `blob_sha` through `git cat-file --batch`. The full list at an older version is resolved against the current card data.
  * The per-card diff between two versions is computed when the page is requested.
  * That is expected to take milliseconds, because it compares two lists of at most 250 lines each.
* **Old versions.** A version that no longer parses under the current schema is shown as raw text with a notice.
* **Limit.** The history list shows at most 100 versions by default (`HISTORY_MAX_VERSIONS`), which caps the page size for long-lived decks.

**Routes.**

| Route | Purpose |
|---|---|
| `/` | Lists every gauntlet with its name, format, deck count and how many decks are invalid. |
| `/g/<gauntlet>` | Gauntlet page with the description from `gauntlet.md`, the deck list with archetype and tags, legality badges, and a "New deck on GitHub" link. |
| `/g/<gauntlet>/<deck>` | Visual decklist with cards grouped by type and lazy-loaded image previews. Also shows metadata, the inline primer, the legality badge with its violation list, export and proxy buttons, and an "Edit on GitHub" link. |
| `/g/<gauntlet>/<deck>/history` | Version list, with picker controls for comparing two versions. |
| `/g/<gauntlet>/<deck>/v/<commit>` | Full list at that version. Adding `?compare=<commit>` shows the per-card diff. Returns 404 unless the commit appears in `deck_versions` for that deck. |
| `/g/<gauntlet>/<deck>/export/{mtgo,dec}` | Download as `.txt` or `.dec`. |
| `/g/<gauntlet>/<deck>/export/mtga` | A page with the MTGA text and a copy button, because Arena imports from the clipboard. It also lists the cards that aren't on Arena. |
| `/g/<gauntlet>/<deck>/proxies` | Page where the browser builds the PDF. Options: A4 or Letter, and cut lines. |
| `/img/<scryfallId>/<face>` | Image route used by the PDF builder only. `face` is `front` or `back`. It answers 404 unless the ID belongs to a printing in the current snapshot, and `back` is allowed only for cards with a back face. It allows at most 120 requests per minute per client IP, and answers 429 above that. Behind a reverse proxy, the client IP comes from adapter-node's `ADDRESS_HEADER` and `XFF_DEPTH` settings. |
| `/webhook/github` | Accepts a POST checked with HMAC `X-Hub-Signature-256` against `WEBHOOK_SECRET`. It only triggers a sync. The route is turned off when no secret is set. |
| `/healthz`, `/readyz`, `/status` | `healthz` reports that the process is alive. `readyz` reports ready only when a snapshot, card data and a derived index all exist. `status` is JSON. |

* **Edit links.** "Edit on GitHub" links go to `https://github.com/<owner>/<repo>/edit/<branch>/<path>`. New-deck links go to `…/new/<branch>/<gauntlet>`. GitHub then guides people without write access through forking and opening a pull request.
* **Footer.** Every page shows the commit (linked to GitHub), the time of the last sync, the last sync error if there was one, the MTGJSON version, and the engine version.

**Images and the proxy PDF.**

* **Scryfall policy assumptions.** The image design relies on these statements from Scryfall's API documentation (<https://scryfall.com/docs/api>):
  * Hotlinking from `*.scryfall.io` is allowed, and those hosts have no rate limit.
  * High-volume users should cache their own copies.
  * Images must not be cropped, distorted or watermarked, and the artist and copyright lines must stay visible.

  These statements were taken from search results quoting that page on 2026-11-15. The page itself refused automated fetches. Spike 5 verifies the wording before release.
* **Page images.** Pages use `<img loading="lazy">` with Scryfall's `small` and `normal` image URLs, built from the printing's `scryfallId`.
* **PDF images.** The PDF builder fetches the `large` JPEG (672×936) of each face through `/img/…`. Each unique image is embedded in the PDF once, then drawn once per copy.
  * The server fetches each image from `cards.scryfall.io` only, with a descriptive User-Agent and at most 4 fetches at once.
  * It stores images under `DATA_DIR/images/` and removes the least recently used ones once the cache passes `IMAGE_CACHE_MAX_MB` (default 500).
* **Layout.** Each image is placed at 63×88 mm with its aspect ratio kept. A 3×3 grid uses 189×264 mm.
  * On A4 (210×297 mm), that leaves margins of 10.5 mm at the sides and 16.5 mm at the top and bottom.
  * On US Letter (215.9×279.4 mm), it leaves 13.5 mm and 7.7 mm. Most printers need about 4–6 mm.
  * There is no cropping, stretching, recolouring or watermark on the card. An optional "Proxy — not for sale" note is printed in the page margin.
  * Double-faced cards print both faces as separate cards.

### Deck repo contract

* **Gauntlet.** A gauntlet is a top-level folder that contains `gauntlet.yaml`.
  * Top-level folders without `gauntlet.yaml` are not scanned as gauntlets.
  * `formats/` is read for format definitions.
  * `.github/` and folders starting with a dot are not read.
* **`gauntlet.yaml`.** Its fields:
  * `schema_version`: optional, default 1.
  * `name`: required.
  * `format`: required, in one of four forms:
    * `preset:2015-modern@1`: a preset shipped with this tool.
    * `repo:formats/cube.yaml`: a custom definition in the deck repo.
    * `official:modern`: an official format.
    * `modern`: a bare official name, the same as `official:modern`.
  * `description`: optional, short.
* **Deck file.** A deck is `<name>.txt`.
  * The file can start with optional front matter between `---` lines. Its fields are `schema_version`, `name`, `author`, `archetype`, `description`, `tags`, and `source` (an http(s) URL).
  * The list follows the front matter.
    * **Section headers:** `Deck`, `Main`, `Mainboard`, `Sideboard`, `Companion` and `Commander`.
      * Matched case-insensitively, with an optional trailing `:`.
      * `Companion` cards count as sideboard.
      * A `Commander` section is an error (`E-DECK-SECTION`) in every v1 format.
    * **Lists without headers:** cards count as main deck. The first blank line after a card line starts the sideboard, which is how MTGO lays out a list.
    * **`SB:` lines:** `SB: <card line>` puts a single line in the sideboard. Any whitespace is allowed after `SB:`.
    * **`[SET]` hint:** a Magic Workstation style `4 [SET] Name` line, as in `.dec` files, is accepted. The bracketed code is used only if it is an MTGJSON set that has the card, and is ignored otherwise.
    * **Full grammar:** in `spec/deck-file.md` (implementation item 16).
  * Each card line is `<count> <name> [(<SET>) [<number>]]`, at most 300 characters long. Lines starting with `//` or `#` are comments.
  * "Arena-style" means the format MTG Arena uses for import and export.
  * Card names follow MTGJSON:
    * Split cards are written `Fire // Ice`.
    * Double-faced cards (DFCs), which have a card face on each side, and adventure cards, which carry a second, smaller spell, may be written by their front-face name.
  * `gauntlet.txt` is a reserved name and is not treated as a deck.
* **Primer.** The primer is `<name>.md` next to the deck file. It is shown inline on the deck page. A `.md` file with no matching `.txt` is ignored and logged as a warning.
* **Identity.** A deck's identity is its path. History follows renames that git detects.

### Format-definition schema v1

* **Fields:**
  * `schema_version`, `id`, `name`.
  * `legality_by: name`. This is the only value in v1, and it is the extension point for printing-based formats later.
  * `sets`: an explicit list of set codes.
  * `banned` and `restricted`: lists of card names.
  * `include` and `exclude`: per-card overrides, each with a `reason`.
  * `deck`: `min_main`, `max_main` (optional), `max_sideboard`, `max_copies`, and `copy_exempt`. The default for `copy_exempt` is `[basic_lands, any_number_text]`.
* **How the pool is computed.** The pool is every card with at least one *pool printing*, plus `include`, minus `exclude` and `banned`.
  * A pool printing is a printing in a set listed in `sets` that is not `isFunny` (Un-sets), `isOnlineOnly` or `isOversized`.
  * Promo printings count only when their own set code is listed. MTGJSON gives promo sets their own codes, so listing a core set or an expansion never brings in promos from unlisted sets.
  * Tokens are not cards in MTGJSON, so they are never in the pool.
  * Names are matched by the MTGJSON full card name, or by the front-face name of a double-faced or adventure card. A back-face name, or one half of a split card on its own, does not match.
  * A card that is "not in pool" (`E-LEGAL-NOT-IN-POOL`) has no pool printing and is not listed in `include`.
* **Where definitions live.**
  * Presets live in this repo at `presets/<id>@<n>.yaml` and are immutable once released.
  * Deck repos refer to custom formats with `repo:formats/<file>.yaml`.
  * A deck repo can't define a `preset:` ID, so it can't override a preset with its own version.
* **Official formats.** `official:<name>` reads the matching MTGJSON legality column and uses that format's deck rules from this built-in table:

  | Formats | Main deck | Sideboard | Copies | Other |
  |---|---|---|---|---|
  | `standard`, `pioneer`, `modern`, `legacy`, `pauper` | 60 or more | 15 or fewer | 4 | — |
  | `vintage` | 60 or more | 15 or fewer | 4 | Cards that MTGJSON marks `Restricted` are limited to 1 copy. |

  Commander is not supported in v1. It needs a commander zone, singleton rules and color-identity checks.

### Default printing

When a deck line has no set code, the engine shows the card's default printing. For formats that check legality by name, the default printing affects display only, never legality.

* **Qualifying printings.** A printing qualifies when all of these hold:
  1. Its MTGJSON `availability` includes `paper`.
  2. It is not `isOnlineOnly`, `isFunny` or `isOversized`.
  3. It is a front-face row (`side` is NULL or `a`), so a back face is never picked.
  4. Its `language` is `English`. Without this rule, spike 1 found 85 `official:modern` cards defaulting to a foreign-language printing.
  5. It is not `isPromo`, unless the card has no non-promo printing.
  6. For a custom format, it is in a set listed in `sets`.
* **Order.** Qualifying printings are sorted by these keys, and the first one wins:
  1. Release date, oldest first. The card's `originalReleaseDate` is used when present, otherwise the set's `releaseDate`.
  2. Set type, with `core` and `expansion` before all others.
  3. The numeric part of the collector number, ascending.
  4. The collector number as text.
  5. The MTGJSON `uuid`.
* **Change after v1.0.1: basic lands.** `Plains`, `Island`, `Swamp`, `Mountain` and `Forest` default to their Unhinged printing (`UNH` 136 to 140, English, paper), although it is `isFunny`. This is an exception to qualifying rule 2 and the order, not a change of either: they still apply to every other card, and to a basic whose Unhinged printing is missing from the card data. Lines with a set code, the MTGA Arena-printing preference, and the pools are unchanged. `insertUnhingedBasics` fills these rows before `insertDefaultPrinting`, and `TOOL_SCHEMA` went from 1 to 2 so that existing derived files are rebuilt on the next start.
* **Stability.** A new printing is always newer than the existing ones, so it can never change which printing is oldest. The default therefore stays the same over time.
* **Set code without a collector number.** A line with a set code but no collector number uses the lowest collector number in that set.

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DECK_REPO_URL` | required | Must match the URL grammar in Security. Any other value fails at startup with a clear message. |
| `DECK_REPO_BRANCH` | `main` | The branch the app tracks. |
| `DATA_DIR` | `/data` | The volume for the clone, card data, derived files, history and the image cache. |
| `PORT` | `3000` | HTTP port. |
| `PUBLIC_BASE_URL` | none | Used for absolute links and as the webhook URL shown in `/status`. |
| `POLL_INTERVAL_SECONDS` | `30` | Interval of the `ls-remote` poll. Minimum 10. |
| `WEBHOOK_SECRET` | none | Turns on `/webhook/github`. |
| `MTGJSON_BASE_URL` | `https://mtgjson.com/api/v5` | MTGJSON download location. |
| `MTGJSON_REFRESH_HOURS` | `24` | How often the app checks `Meta.json`. |
| `IMAGE_CACHE_MAX_MB` | `500` | Size cap of the PDF image cache. |
| `HISTORY_MAX_VERSIONS` | `100` | Maximum versions in a history list. |
| `LOG_LEVEL` | `info` | Log level of the structured JSON logs. |
| `PRESETS_DIR` | `/app/presets` | Where the bundled presets are read from. |
| `ADDRESS_HEADER`, `XFF_DEPTH`, `ORIGIN` | unset | adapter-node settings for running behind a reverse proxy. They give the real client IP for rate limiting, and the public origin. |
| `ALLOW_INSECURE_TEST_REPO_URL` | unset | **Test only, unsupported in production.** Accepts `1` or `true`. Allows `http://` and `file://` repo URLs and the matching git protocols, so tests can use a local repo. Startup logs a warning when it is set. |

### Cold start

1. The process starts and `/healthz` returns ok. `/readyz` returns 503 until step 4 finishes.
2. The app clones the repo and runs the MTGJSON refresh at the same time.
3. Once both are done, the app builds any format tables the refresh did not already build (formats first seen in the repo), then builds `history.sqlite` from scratch.
4. The first snapshot is built and swapped in, and `/readyz` returns 200.

The expected time is dominated by the MTGJSON download and the history build. Spikes 1 and 4 measure both, against the thresholds in Open Questions.

### Security

* **Trust model.** One instance shows exactly one repo, and the host has chosen to trust that repo. The content is still treated as untrusted when it is rendered.
* **Markdown.** It goes through markdown-it with `html: false`. Links are limited to http(s) and `mailto:`, external links get `rel="noopener nofollow"`, and images inside primers are not allowed.
* **Content Security Policy.** It is set through SvelteKit's `kit.csp` with `mode: 'auto'`, which uses nonces for server-rendered pages. The directives:

  | Directive | Value |
  |---|---|
  | `default-src` | `'self'` |
  | `script-src` | `'self'` plus the nonce |
  | `style-src` | `'self' 'unsafe-inline'`, because Svelte adds inline styles |
  | `img-src` | `'self' https://cards.scryfall.io data: blob:` |
  | `connect-src` | `'self'` |
  | `frame-src` | `'none'` |
  | `object-src` | `'none'` |
  | `base-uri` | `'self'` |
* **Limits.**
  * Files of 256 KB at most.
  * 250 card lines per deck, each at most 300 characters.
  * 200 decks per gauntlet.
  * 64 KB of YAML front matter, with a nesting depth of 10 at most.
* **Parser safety.** The card-line grammar uses anchored patterns without nested quantifiers. Matching time therefore grows linearly with line length, so a crafted line can't cause catastrophic backtracking (ReDoS).
* **Repo URL grammar.**
  * `DECK_REPO_URL` must be an `https://github.com/<owner>/<repo>` URL, optionally ending in `.git` or `/`.
  * It may not contain user info, a query, a fragment or any extra path.
  * The exact regular expression is in `spec/gauntlet.md` (implementation item 17).
  * The app normalises the URL to a lower-case owner and repo with no `.git` suffix.
* **Git.** This is the only list of git settings. Implementation item 52 uses it as written.
  * Git runs through `execFile` with no shell, and git 2.32 or later is required.
  * **Environment:** `PATH` and `LANG` are kept from the parent process, and these are set:
    * `HOME=<DATA_DIR>/home`
    * `GIT_TERMINAL_PROMPT=0`
    * `GIT_CONFIG_NOSYSTEM=1`
    * `GIT_CONFIG_GLOBAL=/dev/null`
    * `GIT_ALLOW_PROTOCOL=https`
  * **Flags on every call:** `-c core.hooksPath=/dev/null`, `-c protocol.file.allow=never`, `-c http.followRedirects=false` and `-c safe.directory=<repo dir>`.
  * **Clone:** uses `--no-recurse-submodules`.
  * **Effect:** no global config, `insteadOf` rule, hook, submodule or redirect can change where git connects or what it runs.
  * **Test mode** (`ALLOW_INSECURE_TEST_REPO_URL`): `GIT_ALLOW_PROTOCOL=https:http:file` and `protocol.file.allow=always`. Nothing else changes.
* **Webhook.**
  * It checks `X-Hub-Signature-256` with a constant-time comparison.
  * It reads only two things from the payload: the event type header and the `ref` field. It uses them to ignore pushes to other branches.
  * No other payload field is used, and the payload never supplies data to the sync.
  * Replay protection is not needed. A replayed request can only trigger a sync, and syncs are rate-limited and safe to repeat.
* **Image route.**
  * It serves only `scryfallId`s present in the current snapshot.
  * It fetches only from `cards.scryfall.io`, and follows no redirects.
  * It is rate-limited per client IP (see Routes).
* **Deck-repo CI trust.** The template workflow runs on `pull_request`, never on `pull_request_target`. It has `permissions: contents: read` and needs no secrets. Fork pull requests therefore never receive secrets or write access.
* **Container.** It runs as non-root, and every write goes to `DATA_DIR`.

### Versioning and releases

* **Releases.** One git tag in this repo produces:
  * the app image `ghcr.io/flippyboy/tcg-gauntlet`
  * the validator image `ghcr.io/flippyboy/tcg-gauntlet-validator`
  * the Action, under a major tag `v1`
* **Tags.** Git tags and image tags use the same form, `v1.4.2`, `v1.4` and `v1`, plus `latest`.
* **Pinned Action image.** The release writes the validator image's exact digest into `actions/validate/action.yml`. The Action therefore never works out an image tag from the ref it was called with, and pinning the Action by commit SHA works too.
* **Version numbers.** Versions follow semver. A breaking change to the engine, a schema or the error codes means a new major version.
* **Schema versions.** `gauntlet.yaml`, format definitions and deck front matter each carry an integer `schema_version`.
  * In `gauntlet.yaml` and deck front matter, a missing value means version 1. Format definitions must state it, because they are shared and their hash depends on the full document.
  * v1 is the only version. Once v2 exists, the app and the validator support the current version and the one before it.
  * Validation rules come from one source: the JSON Schemas, compiled into the engine at build time. The app and the validator call the same engine functions, so they report the same codes. Unknown front-matter fields are a warning in both.
  * A file with a newer version than the tool knows produces an error on that gauntlet, and nothing in that gauntlet is partly rendered.
* **Version display.** The engine version, the format key and the MTGJSON version appear in validator output, in `/status`, and in the page footer.

## Alternatives Considered

### Hosting and runtime

#### Alternative A: GitHub Pages (static site built by Actions)

*   **Pros**:
    *   No server to run.
    *   Free hosting.
    *   No server process to fail at runtime.
*   **Cons**:
    *   Each build and deploy takes 1–3 minutes (author's observation of GitHub Actions Pages deploys).
    *   Every host needs Actions set up.
    *   Every version of every deck would have to be rendered ahead of time.
*   **Reason for Rejection**: Rejected by author. The delay after a push is too long, and goal G6 asks for seconds.

#### Alternative B: Static site rebuilt inside the container, served by nginx

*   **Pros**:
    *   No CI on the host's side.
    *   Little runtime attack surface.
    *   Updates could land within seconds, but only if rebuilds are fast. Rebuild time was not measured.
*   **Cons**:
    *   Every history page and diff must be pre-rendered on each rebuild.
    *   The PDF builder still needs a same-origin image route, so some server would run anyway.
    *   It means two processes in one image.
*   **Reason for Rejection**: Rejected by author in favour of a dynamic server. Every version page and every pair of versions for a diff would have to be pre-rendered on each rebuild. The PDF image route needs a server anyway. "No CI per host" doesn't separate the options, because this alternative meets it too.

### Web framework

#### Alternative C: Fastify with HTML templates and hand-written client scripts

*   **Pros**:
    *   Fewest dependencies.
    *   No framework conventions or framework upgrades to follow.
    *   Direct control of the sync loop.
*   **Cons**:
    *   Card previews, diff toggles and the PDF builder all need hand-written browser code.
    *   No component model as the UI grows.
*   **Reason for Rejection**: Rejected by author: SvelteKit's component model covers card previews, diff toggles and the PDF builder with less hand-written browser code.

#### Alternative D: Next.js (React, standalone output)

*   **Pros**:
    *   Largest ecosystem and the most tutorials.
*   **Cons**:
    *   Larger build and runtime than SvelteKit, and React server components add a second rendering model.
    *   Caching and routing rules change often between versions.
    *   Running a background sync loop in standalone mode is awkward.
*   **Reason for Rejection**: Rejected by author: the background sync loop and the single small container fit poorly with Next.js standalone output.

### Card data

#### Alternative E: Scryfall bulk data as the card source

*   **Pros**:
    *   The same source as the card images.
    *   Includes legality for each card.
*   **Cons**:
    *   Large JSON files that need a custom import step.
    *   No ready-made SQLite build.
*   **Reason for Rejection**: Rejected by author in favour of MTGJSON. MTGJSON offers `AllPrintings.sqlite` directly, and each printing has a `scryfallId` that can be used to build image URLs.

#### Alternative F: Card data baked into the container image

*   **Pros**:
    *   Instant cold start.
    *   Data pinned per release with no extra work.
*   **Cons**:
    *   Image size grows by hundreds of MB.
    *   Data goes stale until the next release.
    *   Rebuilding the image for each data update is a release task.
*   **Reason for Rejection**: Rejected by author. Card data is downloaded at runtime and cached on disk under its checksum.

#### Alternative G: Extract a slim copy of card data, then delete the MTGJSON file

*   **Pros**:
    *   Only the extraction step depends on MTGJSON's schema.
    *   Smaller disk use.
*   **Cons**:
    *   More code to maintain.
    *   Each MTGJSON update takes longer to rebuild.
*   **Reason for Rejection**: Rejected by author in favour of querying MTGJSON directly. To limit the risk, every MTGJSON query lives in one module and the app checks MTGJSON's schema at startup.

#### Alternative H: Whole card index held in memory

*   **Pros**:
    *   Fastest lookups.
    *   Simplest lookup code.
*   **Cons**:
    *   Likely 100–300 MB of memory, plus more for each custom format. This is an estimate, which spike 1 measures.
    *   Every restart waits while the index loads.
*   **Reason for Rejection**: Rejected by author: by that estimate it may exceed the memory of small hosts, while SQLite lookups keep memory flat.

#### Alternative I: Writing custom-format legality into MTGJSON's database

*   **Pros**:
    *   A single database file.
*   **Cons**:
    *   Modifies a downloaded file, so its checksum no longer identifies it.
    *   Every MTGJSON update overwrites the changes.
    *   Formats can't be rebuilt one at a time.
*   **Reason for Rejection**: Rejected. A separate derived file keyed by format definition hash keeps the MTGJSON file unchanged, and lets each format be rebuilt on its own.

#### Alternative J: MTGJSON or Scryfall current legality for frozen formats

*   **Pros**:
    *   No definition file to write.
*   **Cons**:
    *   Both sources show only today's official legality, so they can't describe 2015 Modern.
*   **Reason for Rejection**: Rejected. A format definition with an explicit set list and banlist is the only authority for custom formats.

#### Alternative K: Date ranges instead of set lists in format definitions

*   **Pros**:
    *   Shorter definitions.
*   **Cons**:
    *   Unclear at the boundaries. Promos, supplemental sets, and sets released on the boundary date can fall either way.
*   **Reason for Rejection**: Rejected. Explicit set codes give an exact pool.

### Version history

#### Alternative L: History computed on request, cached in memory

*   **Pros**:
    *   No history work during sync, and no history work at cold start.
    *   Nothing stored on disk.
*   **Cons**:
    *   The first history view of each deck after a restart waits for git to walk that file's history.
*   **Reason for Rejection**: Rejected by author: history pages should not wait on git. Computing history during sync moves that cost off the request path.

#### Alternative M: Precompute diffs too

*   **Pros**:
    *   No computation at request time at all.
*   **Cons**:
    *   Comparing any two of N versions needs up to N² stored diffs, and the stored data grows with every commit.
*   **Reason for Rejection**: Rejected: the storage grows with the square of the version count. A diff computed from two stored parsed versions is expected to take milliseconds.

#### Alternative N: Shallow or partial git clone

*   **Pros**:
    *   Faster first clone.
    *   Smaller disk use.
*   **Cons**:
    *   No full history.
    *   Following renames is slow or impossible.
*   **Reason for Rejection**: Rejected. Goal G8 needs the full history.

### Images

#### Alternative O: All images served through the app route

*   **Pros**:
    *   Closest to Scryfall's request that high-volume users cache their own copy.
    *   Images can be limited to the app's own origin.
    *   Cached images still show during a Scryfall outage.
*   **Cons**:
    *   The app carries all image traffic and disk use.
    *   The non-goal *Image mirroring* in this document would be reversed.
*   **Reason for Rejection**: Rejected by author: page images load directly from Scryfall, which Scryfall's documentation allows (see Scryfall policy assumptions). The app then carries no page-image traffic, and only the PDF goes through the cached route.

#### Alternative P: All images direct from Scryfall, including the PDF

*   **Pros**:
    *   No image code on the server.
*   **Cons**:
    *   The PDF depends on Scryfall's image host sending CORS headers that allow `fetch()`, which is unverified.
    *   Ignores the caching request if traffic grows.
*   **Reason for Rejection**: Rejected by author: proxy printing would break with no server-side fix if those CORS headers are missing. Spike 5 checks the headers, and the decision can be revisited if they are present.

### Content model

#### Alternative Q: One folder per format

*   **Pros**:
    *   Simplest layout.
*   **Cons**:
    *   Several gauntlets in one format can't exist side by side.
*   **Reason for Rejection**: Rejected by author. A folder is a gauntlet, and each gauntlet declares its format in `gauntlet.yaml`.

#### Alternative R: Sharing decks between gauntlets by reference

*   **Pros**:
    *   No copies to keep in sync.
*   **Cons**:
    *   Cross-folder links, history that spans folders, and a deck that is legal in one gauntlet but not another.
*   **Reason for Rejection**: Rejected by author: a reference would make a deck's history span folders, and the same file could be legal in one gauntlet and illegal in another. Copying ties each deck's verdict to one format.

#### Alternative S: A stable `id` field for deck identity

*   **Pros**:
    *   History survives any rename.
    *   Copies can be detected.
*   **Cons**:
    *   One more field to manage.
    *   Collisions after a copy and paste.
*   **Reason for Rejection**: Rejected by author: an `id` field adds a collision risk when a deck is copied and pasted, while git rename detection already covers the common rename case.

#### Alternative T: Primer inside the front matter

*   **Pros**:
    *   One file per deck.
*   **Cons**:
    *   Long Markdown inside YAML is awkward to edit and review.
*   **Reason for Rejection**: Rejected by author: long Markdown inside YAML is hard to edit and to review in pull-request diffs. A separate `<name>.md` file next to the deck shows up as a normal Markdown diff.

#### Alternative U: Forge `.dck`, or plain Arena text with metadata in comments

*   **Pros**:
    *   `.dck` has a built-in metadata section.
    *   Plain Arena text can be pasted anywhere.
*   **Cons**:
    *   Few tools import `.dck`.
    *   Comments can't hold structured fields cleanly.
*   **Reason for Rejection**: Rejected: optional YAML front matter plus an Arena-style list keeps the list readable and holds structured fields. Losing metadata on export is acceptable.

#### Alternative V: Newest legal printing as the default printing

*   **Pros**:
    *   Shows modern card frames.
*   **Cons**:
    *   Changes whenever a reprint appears, so the same deck file renders differently over time.
*   **Reason for Rejection**: Rejected by author in favour of the oldest qualifying printing. A new printing can't change which one is oldest, so the result stays the same.

### Scope

#### Alternative W: Swedish Old School and printing-based legality in v1

*   **Pros**:
    *   Proves the schema against a second, different format.
*   **Cons**:
    *   Needs printing-level pool tables and matching on set plus collector number in the engine. Name-based restricted lists are already in v1, so restrictions alone add no cost here.
*   **Reason for Rejection**: Deferred by author: 2015 Modern needs neither printing-level tables nor set-plus-number matching. `legality_by` is kept as the extension point.

#### Alternative X: Use existing tools (Moxfield, mtgtop8, badaro's validator)

*   **Pros**:
    *   Nothing to build.
*   **Cons**:
    *   None of them combines review before merge, card-level history in git, and checks for custom formats in both CI and a viewer (as checked by the author in November 2026).
*   **Reason for Rejection**: Rejected by author: none of these tools offers review before merge, card-level history, and custom-format checks in CI.

## Non-Functional Requirements

*   **Security & Privacy**: The full rules are in the Technical Plan's Security section. In summary:
    *   Repo content is treated as untrusted.
    *   Git is locked down.
    *   The webhook is only a trigger.
    *   The image route is allow-listed and rate-limited.
    *   Deck-repo CI runs without secrets.

    There are no accounts and no personal data. The only identity shown is git author names that are already public in the repo.
*   **Performance & Latency**:
    *   **Targets.** The goals set these targets:
        *   push to visible: 45 s by polling, 10 s with the webhook (G6)
        *   validator: under 60 s with a warm cache and under 5 minutes with a cold cache (G5)
    *   **Speed.** Page renders come from memory, plus SQLite lookups for history pages.
    *   **Memory.** Target under 512 MB resident for a repo with 200 decks, including the SQLite page cache. It is measured as peak resident memory during the e2e smoke test, using the fixture data and the real MTGJSON file from spike 1.
    *   **Disk.** The MTGJSON file (two versions kept) plus derived files, history and the image cache. Spike 1 measured a peak of about 2.4 GB during a card-data refresh. The documented minimum is 4 GiB for card data, and 5 GiB including history and images.
*   **Rollout & Rollback**: The full rules are in the Technical Plan's Versioning and releases section. In summary:
    *   **Rollback.** A host rolls back by pinning the previous image tag.
    *   **Data compatibility.** The derived files and `history.sqlite` record the schema version of the tool that wrote them. A tool that finds an unknown version rebuilds them from git and the currently published MTGJSON release.
    *   **Deck repos.** Deck repos pin the validator Action at `v1`.

## Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation | Related spike |
|---|---|---|---|---|---|
| R1 | MTGJSON is unavailable when the app or CI refreshes. | Medium | App: none, it keeps the current cached version. CI: PRs fail with exit 2 on a cold cache. | The app keeps serving the cached version. CI uses the cached data when present. The outage is shown in `/status` and in CI output. | 1 |
| R2 | MTGJSON stops serving older versions. | High (assumed) | A version that was checked can't be downloaded again. | Repeatable verdicts for frozen formats come from the format definition's explicit set list and banlist. Official formats are documented as moving (G4). | 1 |
| R3 | MTGJSON changes its SQLite schema. | Medium | Card lookups break after a refresh. | All SQL lives in one module, and the self-check refuses a new version that doesn't match, so the old version stays in use. A scheduled canary workflow in this repo runs the self-check and the conformance corpus against the latest MTGJSON. A failed run notifies the maintainers. | 1 |
| R4 | Scryfall changes its policy, blocks hotlinking, or a CSP change breaks images. | Low | Card images don't load on pages. | Pages still show card names and counts without images. The PDF already goes through the server route. Spike 5 confirms the current policy. | 5 |
| R5 | GitHub throttles `ls-remote` polling. | Low | Updates arrive late. | Polling backs off on HTTP 429 and 5xx. The webhook still triggers a sync. | — |
| R6 | History build is slow on large repos. | Medium | Updates and cold start are delayed. | Spike 4 passed: 253 ms for 3,000 commits. If a much larger repo misses the threshold, history moves to a background stage. | 4 |
| R7 | The disk fills. | Low | Refreshes and history rebuilds fail. | Image cache cap, two-version retention, free-disk figure in `/status`, and a documented minimum volume size. | 1 |
| R8 | Syncs keep failing. | Medium | Stale content is served. | Retry with backoff, plus a staleness banner after 3 failures in a row (Sync loop). | — |
| R9 | CI and the app disagree after an MTGJSON update. | Medium for official formats, low for presets | A PR passes CI but shows as illegal in the app. | The MTGJSON version is shown in the badge and in CI output (G4). A version pin in the deck repo is listed as a future improvement. | — |
| R10 | The 2015 Modern preset doesn't match 2015modern.com. | Medium | Wrong verdicts. | Spike 2 found zero differences. Any future preset revision repeats the comparison (item 23). | 2 |
| R11 | Fork PRs run untrusted content in CI. | Certain | Exposure only if secrets were present. | The template uses `pull_request` with read-only permissions and no secrets (Security). | — |
| R12 | pdf-lib is no longer maintained. Its maintenance status is unverified. | Medium | Bugs in PDF output don't get fixed upstream. | pdf-lib is used only in `pdf.ts`. The fork `@cantoo/pdf-lib` has the same API and is the fallback. | — |

## Future Improvements

*   **Data-version pin.** An optional `data_version` pin in the deck repo, which CI and the app would both honour so that both check against the same MTGJSON version. A bot would open pull requests to move the pin forward.
*   **Commander.** A commander zone, singleton rules and color-identity checks.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Work is ordered in phases.

* **What must pass after each phase.** Lint, format check, typecheck, build, and whatever tests exist so far.
* **When CI steps are added.** A CI step is added in the phase that creates the code it checks (item 11).
* **What spikes can change.** Phase 0 spikes produce written findings. Those findings can change numbers and MTGJSON table or column names later in this plan.
  * If a spike misses its threshold, the design switches to the fallback named in Open Questions.
  * The spike 1 fallback adds one deliverable: a published card-data file.
  * The spike 5 outcome could have removed the `/img` route. The author kept it (2026-11-15).

### Phase 0 — Spikes

Each spike writes its findings to `docs/spikes/<name>.md`. Its throwaway scripts go in `spikes/<name>/`, and they are not part of any package.

#### 1. `docs/spikes/mtgjson-size.md`, `spikes/mtgjson-size/measure.ts` (Create)

*   **Type / Scope**: Spike 1 findings and script.
*   **Proposed Changes**: Record:
    *   The download size of `AllPrintings.sqlite.gz`, and its size once unpacked.
    *   Download and unpack time on a 4-vCPU GitHub runner and on a 2-vCPU host.
    *   Peak resident memory, including the SQLite page cache.
    *   The real table and column names. They are needed for:
        *   cards, sets, legalities, identifiers and availability
        *   `isFunny`, `isOnlineOnly`, `isOversized`, `isPromo`
        *   `originalReleaseDate`, set `type`, set `releaseDate`
        *   `supertypes`, `text`, `faceName`, `side`, `layout`
    *   The time to build every derived table for `preset:2015-modern@1` and for `official:modern`.
    *   Which fields `Meta.json` holds (expected: `data.version` and `data.date`).
    *   Whether a `.sha256` file is published next to each download.
    *   Whether `https://mtgjson.com/api/v5/` lists older versions.
    *   Whether better-sqlite3 accepts `file:…?mode=ro` URIs in `ATTACH`.
*   **Effect on this plan**:
    *   The findings set the minimum volume size and the SQL in `mtgjson-queries.ts` (item 43).
    *   They are compared with the spike 1 thresholds in Open Questions.

#### 2. `docs/spikes/modern-2015-pool.md`, `spikes/modern-2015-pool/compare.ts`, `spikes/modern-2015-pool/site-pool.txt` (Create)

*   **Type / Scope**: Spike 2 findings, script and checked-in reference list.
*   **Proposed Changes**:
    *   Save the card names from 2015modern.com's card search to `site-pool.txt`.
    *   Build the pool from MTGJSON for the set list in item 22, minus its banlist, and compare the two name by name.
    *   Record every difference, and the decision for it, as an `include` or `exclude` entry with a `reason`.
*   **Known item to check**: Time Spiral "Timeshifted" (`TSB`). The spike found that its set type is `expansion`, so the site's query includes it.

#### 3. `docs/spikes/mtgtop8-exports.md`, `conformance/layout-samples/mtgtop8/*` (Create)

*   **Type / Scope**: Spike 3 findings and layout reference files.
*   **Proposed Changes**:
    *   Download the MTGO and `.dec` exports, and copy the MTGA text, for three mtgtop8 decks that have sideboards and split cards.
    *   Record the line endings, the sideboard marker, and how set codes are written.
    *   These files are a layout reference only. Each deck is re-created as a conformance case (item 41) using cards from the fixture set.

#### 4. `docs/spikes/git-history-cost.md`, `spikes/git-history/generate.ts` (Create)

*   **Type / Scope**: Spike 4 findings and script.
*   **Proposed Changes**:
    *   Make a synthetic repo with 100 decks and 3,000 commits, including renames, deletes and merge commits.
    *   Time a full `history.sqlite` rebuild with the history pass from the Technical Plan.
    *   Time an incremental update after a 10-file push.
    *   Compare both with the spike 4 thresholds.

#### 5. `docs/spikes/scryfall-policy-cors.md`, `spikes/scryfall-cors/index.html` (Create)

*   **Type / Scope**: Spike 5 findings and test page.
*   **Proposed Changes**:
    *   Read Scryfall's API documentation in a browser. Record, with the date, the current wording on hotlinking, rate limits, caching and image use.
    *   From the test page, served on another origin, call `fetch()` on a `cards.scryfall.io` image and record the `Access-Control-Allow-Origin` header.
    *   **If CORS is allowed:** the author decides whether to remove the `/img` route. Outcome: CORS is allowed, and the author kept `/img`.
    *   **If CORS is not allowed:** `/img` stays as designed.

### Phase 1 — Repository scaffolding

#### 6. `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `.node-version` (Create)

*   **Type / Scope**: Workspace root.
*   **Proposed Changes**:
    *   **`package.json`:**
        *   Private package with `"packageManager": "pnpm@<latest 10.x at scaffold time>"`.
        *   `"pnpm": {"onlyBuiltDependencies": ["better-sqlite3", "esbuild"]}`.
        *   Scripts:

            | Script | Runs |
            |---|---|
            | `build` | `pnpm -r build` |
            | `test` | `pnpm -r build && vitest run --coverage --passWithNoTests` |
            | `lint` | `eslint .` |
            | `format` | `prettier --check .` |
            | `typecheck` | `tsc -b && pnpm --filter @tcg-gauntlet/app typecheck` |

        *   Dev dependencies, pinned with caret ranges to the latest stable versions at scaffold time: `typescript`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-svelte`, `globals`, `prettier`, `prettier-plugin-svelte`, `@types/node`.
        *   The lockfile is committed.
    *   **`.npmrc`:** `inject-workspace-packages=true`.
    *   **`pnpm-workspace.yaml`:** packages `packages/*`.
    *   **`.node-version`:** `22`.
*   **As built (Phase 1):**
    *   **Versions:** `packageManager` is `pnpm@10.34.9`.
    *   **TypeScript:** pinned to `^6.0.3`, because typescript-eslint 8.72 does not support TypeScript 7 yet. Move to 7 when it does.
    *   **Node types:** `@types/node` is `^22`, to match the Node 22 runtime.
    *   **`typecheck`:** runs `tsc -b` only until Phase 7, which adds the app's `svelte-check`.
    *   **Package metadata:** `package.json` has `"type": "module"`.

#### 7. `tsconfig.base.json`, `tsconfig.json` (Create)

*   **Type / Scope**: TypeScript config.
*   **Proposed Changes**:
    *   **`tsconfig.base.json`:** `strict`, `noUncheckedIndexedAccess`, `target: ES2023`, `module` and `moduleResolution: NodeNext`, `composite`, `declaration`, `outDir: dist`.
        *   Relative imports use `.js` extensions.
    *   **Root `tsconfig.json`:** project `references` to engine, conformance, carddata, repo and validator.
        *   The app is not in `tsc -b`. It has its own tsconfig (item 61).
    *   **Package outputs:** every Node package emits `dist/` and has `"type": "module"`, plus `"exports": {".": {"types": "./dist/index.d.ts", "import": "./dist/index.js"}}`.
        *   Consumers import the built `dist/`.
*   **As built (Phase 1):**
    *   **Root `tsconfig.json`:** also extends the base with `noEmit`, `types: ["node"]` and `include: ["vitest.config.ts"]`.
        *   An empty `files` list with no references fails with TS18002.
        *   The `include` lets typed lint rules check the Vitest config.
        *   `references` starts empty, and each phase adds its packages.
    *   **`tsconfig.base.json`:** adds `lib: ["ES2023"]` and `skipLibCheck: true`.

#### 8. `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.dockerignore` (Create)

*   **Type / Scope**: Lint, format and ignore files.
*   **Proposed Changes**:
    *   **ESLint:** flat config with `@eslint/js`, typescript-eslint's recommended type-checked rules and eslint-plugin-svelte.
        *   A `no-restricted-imports` rule for `packages/engine/**` bans `fs`, `node:fs`, `net`, `child_process` and `node:child_process`.
    *   **Prettier:** uses the Svelte plugin.
    *   **`.prettierignore`:** `conformance/**` (byte-exact fixtures, some with CRLF), `**/generated/**`, `pnpm-lock.yaml`.
    *   **`.gitignore`:** `node_modules`, `dist`, `build`, `.svelte-kit`, `coverage`, `spikes/**/out`, `/data`, `.tcg-gauntlet-cache`.
    *   **`.dockerignore`:** `node_modules`, `**/dist`, `**/build`, `.svelte-kit`, `coverage`, `data`, `.git`, `spikes`.
*   **As built (Phase 1):**
    *   **Ignored by ESLint and Prettier:** `docs/**`, `spikes/**`, `conformance/**`, the root review reports, `pnpm-lock.yaml`, `**/generated/**` and `CLAUDE.md`.
    *   **Prettier override:** `.prettierrc` sets `parser: svelte` for `*.svelte`.

#### 9. `vitest.config.ts` (Create)

*   **Type / Scope**: Test config.
*   **Proposed Changes**:
    *   `test.projects` with one entry per package.
    *   `exclude: ['**/e2e/**', '**/node_modules/**']`.
    *   Global coverage thresholds keyed by glob:
        *   `'packages/{engine,carddata}/src/**'`: 85% branches.
        *   `'packages/{repo,validator,conformance}/src/**'` and `'packages/app/src/lib/server/**'`: 70% branches.
*   **As built (Phase 1):** `test.projects` is built from the folders that exist under `packages/`, because Vitest rejects an empty or non-matching project list. The config uses `node:fs`. The engine's import ban does not apply to it.

#### 10. `README.md`, `LICENSE` (Create)

*   **Type / Scope**: Project entry doc and license.
*   **Proposed Changes**:
    *   **README:** what the project is, the three deliverables, a five-line "host it" quick start, the `init` command for a new deck repo, and links to `docs/` and `spec/`.
    *   **`LICENSE`:** the MIT License, copyright holder Filip Jansson.

#### 11. `.github/workflows/ci.yml` (Create, then extended in later phases)

*   **Type / Scope**: CI for this repo.
*   **Proposed Changes**: runs on push and pull request, using `pnpm/action-setup` (version from `packageManager`) and `actions/setup-node` with Node 22.
    *   **Phase 1:** `pnpm install --frozen-lockfile`, `lint`, `format`, `typecheck`, `build`, `test`.
    *   **Phase 3, added:** a step that regenerates the engine's schema validators and fails on any diff (item 28).
    *   **Phase 6, added:**
        *   `docker build` of the validator image.
        *   A validator run with `--all` on `template/`.
        *   A `ci-timing` job. It runs the validator on `template/` twice, first with an empty cache and then with the cache warm, and writes both times to the job summary. It fails if the warm run takes over 60 s.
    *   **Phase 7, added:** `docker build` of the app image, then `pnpm --filter @tcg-gauntlet/app e2e` against it.

#### 12. `.github/workflows/release.yml` (Create)

*   **Type / Scope**: Release pipeline.
*   **Proposed Changes**: Runs when a tag `v*.*.*` is pushed. It has `permissions: contents: write, packages: write`.
    *   **Build setup:** `docker/setup-qemu-action`, `docker/setup-buildx-action`, and `docker/login-action` to GHCR.
    *   **Image names and tags:** `docker/metadata-action` generates the lower-cased image names `ghcr.io/flippyboy/tcg-gauntlet` and `ghcr.io/flippyboy/tcg-gauntlet-validator`.
        *   Tags are `v<major>.<minor>.<patch>`, `v<major>.<minor>`, `v<major>`, plus `latest` for tags without a pre-release part.
    *   **Build:** `docker/build-push-action` builds `linux/amd64` and `linux/arm64`.
    *   **Pinning the Action:** after the validator image is pushed, a step writes the exact `ghcr.io/…-validator@sha256:<digest>` into `actions/validate/action.yml`. It also writes the real `owner/repo@v<major>` into `template/.github/workflows/validate.yml`. Both changes are committed to a release commit, and the tags are moved to that commit.
        *   With the digest written in, the Action never builds an image tag from `github.action_ref`, so a Action pinned by SHA also works.
    *   **Major tag:** the `v<major>` git tag is force-moved to the release commit.
    *   **Release docs:** after the first release, set both GHCR packages to public once, in the package settings.
*   **As built (Phase 1):**
    *   **Placeholders:** the pin step replaces two placeholders with `sed`, and fails if either is missing. Phase 6 must put them in these files:
        *   `__VALIDATOR_IMAGE__` in `actions/validate/action.yml`, replaced with `ghcr.io/flippyboy/tcg-gauntlet-validator@sha256:<index digest>`.
        *   `__ACTION_REF__` in `template/.github/workflows/validate.yml`, replaced with `<repository>/actions/validate@v<major>`.
    *   **Pre-release tags:** a tag containing `-` moves only its exact tag, not `v<major>.<minor>` or `v<major>`.
    *   **0.x versions:** `metadata-action` writes no `v0` tag for them.
    *   **Not automated:** creating a GitHub Release object, and making the GHCR packages public.

#### 13. `.github/workflows/mtgjson-canary.yml` (Create in Phase 4)

*   **Type / Scope**: Scheduled check, mitigating risk R3.
*   **Proposed Changes**: Runs daily on a schedule and also on manual dispatch.
    *   **Steps:**
        1. Download the latest MTGJSON.
        2. Run the `carddata` self-check.
        3. Regenerate the fixtures (item 42) and fail if they differ.
        4. Run the conformance corpus through `SqliteCardLookup`.
    *   **Failure handling:** a failing run notifies the maintainers through GitHub's normal workflow-failure email. No issue is opened.
    *   **Known limit:** GitHub disables scheduled workflows in public repos after 60 days with no repository activity, and the docs say so.

#### 14. `CLAUDE.md` (Modify)

*   **Type / Scope**: Agent instructions.
*   **Proposed Changes**: Add a short "Repository layout" section.
    *   What each package does.
    *   The rule that `engine` has no I/O.
    *   The rule that every MTGJSON SQL query lives in `mtgjson-queries.ts`.

    Keep the existing EGM model section as it is.

### Phase 2 — Specs, schemas and presets

#### 15. `spec/README.md` (Create)

*   **Type / Scope**: Spec index.
*   **Proposed Changes**: Lists the specs and states the `schema_version` policy.
    *   v1 is the only version.
    *   A missing value means 1.
    *   Once v2 exists, the tools support the current version and the one before it.

#### 16. `spec/deck-file.md` (Create)

*   **Type / Scope**: Normative spec.
*   **Proposed Changes**:
    *   **File naming:** `<name>.txt`. The name `gauntlet.txt` is reserved.
    *   **Encoding:** UTF-8. An optional BOM is stripped. Line endings may be CRLF or LF.
    *   **Front matter:** an optional first block between `---` lines. Fields follow item 20.
        *   An unterminated block gives `E-PARSE-FRONTMATTER`.
        *   Unknown fields give `W-FRONTMATTER-UNKNOWN-FIELD`.
    *   **Section headers:** `Deck`, `Main`, `Mainboard`, `Sideboard`, `Companion`, `Commander`.
        *   Matched case-insensitively, with an optional trailing `:`.
        *   The list starts in the main deck.
        *   `Companion` cards count as sideboard.
        *   A header that appears again adds to the same section.
        *   `Commander` gives `E-DECK-SECTION` in every v1 format.
    *   **Blank-line sideboard (MTGO style):** in a list with no section headers, the first blank line after at least one card line starts the sideboard. Once any header has been seen, blank lines are ignored.
    *   **`SB:` lines:** `SB: <card line>` puts a single line in the sideboard. One or more spaces or tabs may follow `SB:`, and it is matched case-insensitively.
    *   **Card line grammar:**
        *   `count`, matching `[1-9][0-9]{0,2}` with an optional `x`, then whitespace, then the name.
        *   An optional bracketed set code may follow the count. This is the Magic Workstation `.dec` form: `4 [M11] Name`, or `4 [] Name` for an empty one.
            *   The code is 0–6 alphanumeric characters, case-insensitive.
            *   It is used to pick a printing only when it is an MTGJSON set code that has the card. Otherwise it is ignored without an error.
            *   A line with both `[SET]` and a trailing `(SET)` gives `E-PARSE-LINE`.
        *   The name is everything before the last ` (` that is followed by a set code and `)`. If no such ` (` exists, the name runs to the end of the line.
        *   `SET` is 2–6 alphanumeric characters, case-insensitive.
        *   An optional collector number follows the set code. It is alphanumeric and may contain `★`, `-` and `/`. `0` is a valid collector number.
        *   Anything after the collector number gives `E-PARSE-LINE`.
        *   A line may be at most 300 characters.
    *   **Other lines:** comments begin with `//` or `#`. The `// NAME : …`, `// CREATOR : …` and `// FORMAT : …` lines in `.dec` files are plain comments and are not read.
    *   **Name matching:** names are normalised as described in the Technical Plan.
        *   The canonical form of a split card is `Fire // Ice`. `Fire/Ice` (MTGO), `Fire / Ice` (`.dec`) and the same with extra spaces are accepted too.
        *   Double-faced and adventure cards may be written by their front-face name.
    *   **Default printing:** follows the Technical Plan section "Default printing".
    *   **Examples:** the spec shows the following, and states that both MTGO forms parse:
        *   an Arena export
        *   an mtgtop8 MTGA list, with a blank-line sideboard and no headers
        *   an MTGO list with a `Sideboard` line
        *   an MTGO list with a blank-line sideboard
        *   a `.dec` file with `[SET]` and `SB:  N` lines
        *   a file with front matter and `SB:` lines

#### 17. `spec/gauntlet.md` (Create)

*   **Type / Scope**: Normative spec.
*   **Proposed Changes**:
    *   **Gauntlet folders:** a gauntlet is a top-level folder containing `gauntlet.yaml`.
        *   Subfolders inside a gauntlet are ignored.
        *   Top-level folders without `gauntlet.yaml` are not scanned as gauntlets.
        *   `formats/` is read for format definitions only.
        *   `.github/` and folders whose names start with a dot are not read.
    *   **`gauntlet.yaml`:** fields as in item 20.
    *   **Sidecar files:** `gauntlet.md` holds the gauntlet description. `<deck>.md` holds the primer for `<deck>.txt`. A `.md` file with no matching `.txt` gives `W-PRIMER-ORPHAN`.
    *   **URLs:** folder and deck names may contain spaces and Unicode. They are percent-encoded in URLs.
    *   **Name collisions:** two deck names in one gauntlet that differ only in case give `E-LIMIT-EXCEEDED`.
    *   **Limits:**
        *   256 KB per file.
        *   250 card lines per deck. Comments and headers don't count.
        *   300 characters per line.
        *   200 decks per gauntlet.
        *   64 KB of YAML per file, with a nesting depth of at most 10.
        *   Symlinks are refused and give `E-LIMIT-EXCEEDED`.
    *   **Repo URL grammar:** the regular expression from the Security section, `^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}?(\.git)?/?$`.

#### 18. `spec/format-definition.md` (Create)

*   **Type / Scope**: Normative spec.
*   **Proposed Changes**:
    *   **Fields:** the v1 fields with their rules (item 21).
    *   **Card pool:** how the pool is computed, as in the Technical Plan.
    *   **Format keys:**
        *   The key is `<ref>#<hash12>`.
        *   `<ref>` is the normalised `format` value from `gauntlet.yaml`: `preset:2015-modern@1`, `repo:formats/cube.yaml` or `official:modern`. A bare `modern` is normalised to `official:modern`.
        *   `<hash12>` is the first 12 hex characters of the SHA-256 of the RFC 8785 (JCS) canonical JSON of the parsed definition, built as follows:
            *   defaults are filled in
            *   `sets`, `banned`, `restricted`, `include` and `exclude` are sorted
            *   `reason` text is left out
        *   Official formats use `#mtgjson` in place of the hash.
    *   **Namespaces:** the prefix alone decides the namespace, so there is no precedence between namespaces.
    *   **Presets:** a preset file's `id` must match the name in its reference.
    *   **Official formats:** the rules table from the Technical Plan is written once here. Its formats are `standard`, `pioneer`, `modern`, `legacy`, `vintage` and `pauper`. Commander is not in v1.

#### 19. `spec/error-codes.md` (Create)

*   **Type / Scope**: Normative spec.
*   **Proposed Changes**: The stable codes:

    | Code | Severity | Meaning |
    |---|---|---|
    | `E-PARSE-LINE` | error | A list line doesn't match the grammar. |
    | `E-PARSE-FRONTMATTER` | error | The front matter is unterminated or isn't valid YAML. |
    | `E-SCHEMA-VERSION` | error | The `schema_version` value is unknown. |
    | `E-SCHEMA-INVALID` | error | A `gauntlet.yaml`, format file or front matter breaks its schema. |
    | `E-CARD-UNKNOWN` | error | The card name is not found. The message gives up to 3 suggestions. |
    | `E-PRINTING-UNKNOWN` | error | The set and number don't exist, or they belong to a different card. |
    | `E-LEGAL-BANNED` | error | The card is banned in the format. |
    | `E-LEGAL-NOT-IN-POOL` | error | The card is not in the format's pool. |
    | `E-LEGAL-RESTRICTED` | error | A restricted card has more than 1 copy. |
    | `E-DECK-MAIN-SIZE` | error | The main deck is outside the format's size limits. |
    | `E-DECK-SIDEBOARD-SIZE` | error | The sideboard has more cards than the format allows. |
    | `E-DECK-COPIES` | error | There are too many copies of a card across main deck and sideboard. |
    | `E-DECK-SECTION` | error | The deck has a section the format doesn't allow, such as `Commander`. |
    | `E-FORMAT-UNKNOWN` | error | The `format` reference doesn't resolve. |
    | `E-FORMAT-INVALID` | error | The format definition is invalid. |
    | `E-LIMIT-EXCEEDED` | error | A size, count or depth limit is exceeded, a symlink is present, or two names collide. |
    | `W-FRONTMATTER-UNKNOWN-FIELD` | warning | The front matter has a field that isn't in the schema. |
    | `W-PRIMER-ORPHAN` | warning | A `.md` file has no matching deck. |
    | `W-MTGA-UNAVAILABLE` | warning | A card isn't available on Arena. |
    | `W-STALE-DATA` | warning | The card-data refresh failed, so cached data was used. |

    **Validator exit codes:**

    *   **0:** no `E-` codes. Warnings are allowed.
    *   **1:** one or more `E-` codes.
    *   **2:** an infrastructure failure with no usable card data, or a usage error.

#### 20. `spec/schemas/deck-front-matter.v1.schema.json`, `spec/schemas/gauntlet.v1.schema.json` (Create)

*   **Type / Scope**: JSON Schemas (draft 2020-12). These are the single source for validation (item 28).
*   **Proposed Changes**:
    *   **Front matter:**

        | Field | Type | Rule |
        |---|---|---|
        | `schema_version` | integer | `const: 1` |
        | `name` | string | 1–120 characters |
        | `author` | string | at most 120 characters |
        | `archetype` | string | at most 60 characters |
        | `description` | string | at most 1,000 characters |
        | `tags` | array of strings | at most 20 unique items, each at most 30 characters |
        | `source` | string | matches `^https?://` |

        Unknown properties are reported as `W-FRONTMATTER-UNKNOWN-FIELD` (D3).
    *   **Gauntlet:**
        *   `schema_version`: optional, `const: 1`.
        *   `name`: required, 1–120 characters.
        *   `format`: required, matching `^(preset:[a-z0-9-]{1,40}@[0-9]{1,4}|repo:formats/[A-Za-z0-9._-]{1,100}\.yaml|(official:)?(standard|pioneer|modern|legacy|vintage|pauper))$`.
        *   `description`: optional, at most 1,000 characters.
        *   `additionalProperties: false`.

#### 21. `spec/schemas/format-definition.v1.schema.json` (Create)

*   **Type / Scope**: JSON Schema.
*   **Proposed Changes**:
    *   **Required fields:**
        *   `schema_version` (`const: 1`).
        *   `id`, matching `^[a-z0-9-]{1,40}$`.
        *   `name`, 1–120 characters.
        *   `legality_by`, one of `["name"]`.
        *   `sets`, 1–500 unique codes matching `^[A-Z0-9]{2,6}$`.
    *   **Optional fields:**
        *   `banned`, `restricted`: unique string arrays. Default empty.
        *   `include`, `exclude`: arrays of `{name, reason}`. Both keys are required in each item. Default empty.
        *   `deck`: an object with `min_main` (default 60), `max_main` (no default), `max_sideboard` (default 15) and `max_copies` (default 4), all integers from 0 to 250.
        *   `deck.copy_exempt`: a subset of `["basic_lands", "any_number_text"]`. Default: both.
    *   `additionalProperties: false`.

#### 22. `presets/2015-modern@1.yaml` (Create)

*   **Type / Scope**: Preset data.
*   **Proposed Changes**:
    *   `schema_version: 1`, `id: 2015-modern`, `name: 2015 Modern`, `legality_by: name`.
    *   `sets`: 8ED, MRD, DST, 5DN, CHK, BOK, SOK, 9ED, RAV, GPT, DIS, CSP, TSP, TSB, PLC, FUT, 10E, LRW, MOR, SHM, EVE, ALA, CON, ARB, M10, ZEN, WWK, ROE, M11, SOM, MBS, NPH, M12, ISD, DKA, AVR, M13, RTR, GTC, DGM, M14, THS, BNG, JOU, M15, KTK, FRF, DTK, ORI.
        *   These are exactly the core and expansion sets released from 8ED to ORI. TSB is an `expansion` set in MTGJSON and Scryfall, and is required to match the site (spike 2).
    *   `banned`: Ancestral Vision, Ancient Den, Birthing Pod, Blazing Shoal, Bloodbraid Elf, Chrome Mox, Cloudpost, Dark Depths, Deathrite Shaman, Dig Through Time, Dread Return, Glimpse of Nature, Great Furnace, Green Sun's Zenith, Hypergenesis, Jace, the Mind Sculptor, Mental Misstep, Ponder, Preordain, Punishing Fire, Rite of Flame, Seat of the Synod, Second Sunrise, Seething Song, Sensei's Divining Top, Skullclamp, Stoneforge Mystic, Sword of the Meek, Treasure Cruise, Tree of Tales, Umezawa's Jitte, Vault of Whispers.
    *   `deck`: `min_main 60`, `max_sideboard 15`, `max_copies 4`.
    *   Comments cite 2015modern.com's banned-cards page and the January 19, 2015 B&R announcement.
    *   A comment notes that Golgari Grave-Troll is legal. Spike 2 confirmed this against the site's banned-cards page.
    *   A comment notes a defect on 2015modern.com: its linked Scryfall query has only 31 exclusions and omits Cloudpost. The banned-cards page lists all 32, and Cloudpost stays banned.
*   **As built (Phase 2):**
    *   **Spec choices:** the specs in `spec/` record every detail this design left open, and they are the reference from now on. The main choices:
        *   An `include`d card that no listed set prints falls back to a default printing from any set.
        *   `E-LIMIT-EXCEEDED` covers card lines over 300 characters.
        *   `E-SCHEMA-INVALID` covers YAML errors in `gauntlet.yaml` and format files. `E-FORMAT-INVALID` covers rules beyond the schema, such as a preset `id` mismatch or a banned name that matches no card.
        *   `banned` wins over `include`.
        *   Examples use Wear // Tear, because Fire // Ice is not in the 8ED–ORI sets.
    *   **Checks:** the preset was re-checked against MTGJSON: 9,186 names, zero differences.

#### 23. `presets/README.md` (Create)

*   **Type / Scope**: Preset policy and changelog.
*   **Proposed Changes**: Presets are immutable once released. A new revision is a new file.
    *   Each preset has a changelog.
    *   A new revision needs:
        *   a spike-2-style comparison with the format's own source
        *   a passing conformance run
        *   one reviewer other than the author

### Phase 3 — `packages/engine` and `packages/conformance`

#### 24. `packages/engine/package.json`, `tsconfig.json` (Create)

*   **Type / Scope**: Package config.
*   **Proposed Changes**:
    *   Package `@tcg-gauntlet/engine`.
    *   Runtime dependency: `yaml`. Dev dependency: `ajv`, for the generator in item 28 only.
    *   Scripts:
        *   `prebuild` writes `src/version.ts` with `ENGINE_VERSION` from `package.json`.
        *   `build` runs `tsc -b`.
        *   `typecheck` runs `tsc --noEmit`.
        *   `test` runs `vitest run`.
        *   `gen:schemas` runs the item 28 generator.
    *   Hashing uses Web Crypto `crypto.subtle.digest('SHA-256', …)`. Node 22 provides it as a global, and it is not I/O.

#### 25. `packages/engine/src/types.ts` (Create)

*   **Type / Scope**: Shared types.
*   **Proposed Changes**:
    *   **Parsing:**
        *   `Section` is `main | sideboard`.
        *   `ParsedLine` is `{line, count, rawName, set?, number?, section}`.
        *   `ParsedDeck` is `{path, frontMatter, lines, warnings, parseErrors, schemaVersion}`.
    *   **Definitions:** `GauntletDef`, `FormatDef`, `OfficialRules`, `FormatKey`.
    *   **Card lookup:**
        *   `CardRef` is `{name, oracleKey, types, supertypes, layout, manaValue, faces: {name, side}[], copyExempt: 'basic' | 'any_number' | null}`.
        *   `PrintingRef` is `{uuid, cardName, set, number, scryfallId, releasedAt, availability, hasBackFace}`.
        *   `OfficialLegality` is `legal | restricted | not_legal`.
        *   The `CardLookup` interface:
            *   `findCard`
            *   `findPrinting`
            *   `inPool(formatKey, card)` for custom formats
            *   `officialLegality(format, card)`
            *   `defaultPrinting`
            *   `arenaPrinting(card)` for the MTGA export
            *   `suggest`
            *   `dataVersion`
        *   The lookup doesn't return banned or restricted status. The engine reads those from the definition.
    *   **Results:**
        *   `ResolvedEntry` and `ResolvedDeck`.
        *   `Violation` is `{code, severity, file, line?, message, suggestion?}`.
        *   `DiffEntry` is `{kind: removed|added|count|printing, section, name, from?, to?}`.
        *   `ExportResult` is `{text, warnings: Violation[]}`.
*   **As built (Phase 3):**
    *   **Types:**
        *   `Section` also has `commander`.
        *   `OfficialLegality` also has `banned`, so that `E-LEGAL-BANNED` and `E-LEGAL-NOT-IN-POOL` can be told apart.
        *   `CardLookup` has an optional `registerFormat(formatKey, def)`, because a key alone can't rebuild a pool.
        *   `ExportOptions.formatName` was added.
    *   **Extra exports:** `checkDeck`, `checkFormatDef`, `sortViolations` and `cardMatchesName`.
    *   **YAML aliases:** `yaml` 2.9 has no `maxAliasCount` option, so aliases are rejected by walking the AST.
    *   **Scripts:**
        *   The build copies the generated validators with `scripts/copy-generated.ts`.
        *   `src/version.ts` is committed.
        *   The ESLint I/O ban applies to `packages/engine/src/**` only, so `scripts/` and `test/` may use `fs`.
    *   **CI order:** typecheck, build, lint, format, the generated-files check, then test. Typed lint needs the built `.d.ts` files.
    *   **Spec updates:** the open cases found while building the engine are recorded in `spec/deck-file.md` ("Edge cases") and `spec/format-definition.md` (combining legality across printings, and what the format key hashes).
    *   **Results:** 240 tests, with 92.5% branch coverage.
    *   **Node versions:** the fixtures need Node 22.13 or later, for `node:sqlite`. Running `.ts` scripts directly needs Node 22.18 or later.

#### 26. `packages/engine/src/parse/front-matter.ts`, `parse/decklist.ts`, `parse/yaml.ts` (Create)

*   **Type / Scope**: Parsers.
*   **Proposed Changes**:
    *   **`yaml.ts`:** `parseYamlLimited(text)` calls `parseDocument(text, {version: '1.2', maxAliasCount: 0, uniqueKeys: true})`.
        *   It refuses input over 64 KB.
        *   It walks the result and refuses nesting deeper than 10 (`E-LIMIT-EXCEEDED`).
        *   It returns values plus the source line of each key, using the document's `range` and a line index.
        *   `gauntlet.yaml`, format files and front matter all use it.
    *   **`front-matter.ts`:** splits off the leading `---` block, and returns the fields and the line offset where the list starts.
        *   A missing block gives `{}`.
        *   An unterminated block gives `E-PARSE-FRONTMATTER`.
    *   **`decklist.ts`:** a parser that reads the file line by line, implementing the item 16 grammar.
        *   It keeps each line's original number.
        *   An unparseable line gives `E-PARSE-LINE`, and parsing continues.
        *   A deck with more than 250 card lines gives `E-LIMIT-EXCEEDED`.

#### 27. `packages/engine/src/parse/gauntlet.ts`, `parse/format-def.ts` (Create)

*   **Type / Scope**: Parsers.
*   **Proposed Changes**: The same order for front matter, `gauntlet.yaml` and format files:
    1. Parse with `parseYamlLimited`.
    2. Check `schema_version`. An unknown version gives `E-SCHEMA-VERSION`.
    3. Run the generated validator from item 28.
    4. Map its errors to `E-SCHEMA-INVALID`, or to `W-FRONTMATTER-UNKNOWN-FIELD` for extra properties in front matter. The line number comes from the key's source line.
    5. Fill in defaults, and return typed definitions plus violations.

    The app and the validator both call these functions, so they report the same codes.

#### 28. `packages/engine/scripts/compile-schemas.ts`, `packages/engine/src/generated/validators.js` (Create)

*   **Type / Scope**: Build-time code generation. Under D2 this is the single source of validation rules.
*   **Proposed Changes**:
    *   Uses `Ajv2020` from `ajv/dist/2020` with `{code: {source: true, esm: true}, allErrors: true, strict: true}` and `ajv/dist/standalone`.
    *   Writes one validator function per schema from `spec/schemas/*.json` into `src/generated/validators.js`.
    *   The output is committed. CI regenerates it and fails on any diff (item 11). At runtime the engine imports only the generated file, never ajv.
    *   No hand-written type guards exist.

#### 29. `packages/engine/src/format-key.ts`, `src/canonical-json.ts` (Create)

*   **Type / Scope**: Utility.
*   **Proposed Changes**:
    *   `canonicalJson(value)` follows RFC 8785 (JCS): sorted keys, no whitespace, ECMAScript number formatting.
    *   `async formatKey(ref, def | null)` applies the item 18 rules. It returns `<ref>#<hash12>`, or `<ref>#mtgjson` for official formats.

#### 30. `packages/engine/src/official-formats.ts` (Create)

*   **Type / Scope**: Data table.
*   **Proposed Changes**:
    *   Maps `standard`, `pioneer`, `modern`, `legacy`, `vintage` and `pauper` to the deck rules in item 18 and to their MTGJSON legality column.
    *   Maps MTGJSON legality values:
        *   `Legal` → `legal`
        *   `Restricted` → `restricted`
        *   `Banned`, `Not Legal`, a missing value, or any other value → `not_legal`

#### 31. `packages/engine/src/normalize-name.ts` (Create)

*   **Type / Scope**: Utility.
*   **Proposed Changes**: `normalizeName(s)` applies the Technical Plan rules, in order:
    1. NFKD, then remove combining marks.
    2. Lower case.
    3. Replace `‘’“”` with `'` and `"`.
    4. Collapse whitespace.
    5. Rewrite every split separator (`/`, `//` with any spacing) as ` // `.

    The derived build (item 47) uses the same function to fill `card_names`.

#### 32. `packages/engine/src/resolve.ts` (Create)

*   **Type / Scope**: Core logic.
*   **Proposed Changes**: `resolveDeck(parsed, formatKey, lookup) → ResolvedDeck`.
    *   **Name lookup:** each line goes through `findCard`. An unknown card gives `E-CARD-UNKNOWN`, with up to 3 suggestions from `suggest()`.
    *   **Explicit printing:** a line with a set code goes through `findPrinting(set, number?, name)`.
        *   If the printing doesn't exist, or belongs to a different card, the line gives `E-PRINTING-UNKNOWN` and the card's default printing is used.
        *   A set code without a number uses the lowest collector number in that set.
    *   **Default printing:** a line without a set code uses `defaultPrinting(formatKey, card)`.

#### 33. `packages/engine/src/validate.ts` (Create)

*   **Type / Scope**: Core logic.
*   **Proposed Changes**: `validateDeck(resolved, rules, formatKey, lookup) → Violation[]`, where `rules` is a `FormatDef` or `OfficialRules`.
    *   **Custom formats:** a card in `banned` gives `E-LEGAL-BANNED`. Otherwise, a card for which `inPool` is false gives `E-LEGAL-NOT-IN-POOL`. A card in `restricted` with more than 1 copy gives `E-LEGAL-RESTRICTED`.
    *   **Official formats:**
        *   `officialLegality` returning `not_legal` gives `E-LEGAL-BANNED` if MTGJSON's value was `Banned`, and `E-LEGAL-NOT-IN-POOL` otherwise.
        *   `restricted` means at most 1 copy.
    *   **Copy counts:** counted across main deck and sideboard combined. `card.copyExempt` cards are exempt, as allowed by `copy_exempt`.
    *   **Deck size:** checks the main-deck and sideboard size, and `E-DECK-SECTION`.
    *   **Output order:** violations without a line first, then by line number, then by code.

#### 34. `packages/engine/src/group-by-type.ts` (Create)

*   **Type / Scope**: Display helper.
*   **Proposed Changes**:
    *   **Groups**, in order: Creature, Planeswalker, Instant, Sorcery, Artifact, Enchantment, Land, Other.
        *   A card goes in the first group whose type it has.
        *   Exception: any card with the type Land goes in Land.
    *   **Sideboard:** forms a single group.
    *   **Order within a group:** mana value, then name.

#### 35. `packages/engine/src/diff.ts` (Create)

*   **Type / Scope**: Core logic.
*   **Proposed Changes**: `diffDecks(a: ParsedDeck, b: ParsedDeck) → DiffEntry[]`.
    *   **Matching:** entries are keyed by (section, normalised name). Counts are summed across lines.
    *   **Printing changes:** a printing is the set code plus number exactly as written. A line with no set code counts as "default printing".
        *   `printing` entries are reported only when both sides give a set code for the card and the codes differ.
        *   When one side gives no set code, no printing entry is reported.
    *   **Sort order:** section, then kind in the order `removed`, `added`, `count`, `printing`, then name.

#### 36. `packages/engine/src/export/mtgo.ts`, `dec.ts`, `mtga.ts` (Create)

*   **Type / Scope**: Exporters.
*   **Proposed Changes**: Each is a pure function from `ResolvedDeck` to `ExportResult`. The MTGA one also takes the `CardLookup`, for `arenaPrinting`.
    *   **MTGO:**
        *   `N Name` lines, then the line `Sideboard`, then the sideboard lines.
        *   No empty line. The `Sideboard` line is left out when the sideboard is empty.
        *   No set codes.
        *   CRLF after every line, including the last.
    *   **`.dec` (Magic Workstation format, as served by mtgtop8):**
        *   The first line is `// Deck file created with tcg-gauntlet`.
        *   Then `// NAME : <deck name>`, plus `// CREATOR : <author>` and `// FORMAT : <format name>` when known.
        *   Card lines are `N [] Name`.
            *   The brackets are always written, and always empty in v1.
            *   Magic Workstation set codes differ from MTGJSON's (`9E` against `9ED`), and there is no mapping.
        *   Sideboard lines are `SB:  N [] Name`, with two spaces after `SB:`.
        *   CRLF after every line, including the last.
    *   **MTGA:**
        *   No `Deck` or `Sideboard` header.
        *   `N Name (SET) num` lines, one empty line, then the sideboard lines in the same form. No empty line when the sideboard is empty.
        *   LF line endings, and no newline after the last line.
        *   A line without a set code uses the card's Arena printing: of its front-face, English printings with `arena` in `availability`, the newest by release date (`originalReleaseDate`, else the set's), then set type (core and expansion first), numeric part of the number, number as text, `uuid`. A card with no Arena printing keeps the resolved printing.
        *   A line with a set code keeps its printing.
        *   Set codes and numbers are MTGJSON's. MTGJSON has no Arena set code, so some sets differ in Arena (Dominaria is `DOM` against Arena's `DAR`).
        *   Only the MTGA export does this. The deck page, validation, MTGO and `.dec` use the resolved printing.
        *   A printing whose `availability` has no `arena` stays in the text and adds `W-MTGA-UNAVAILABLE` to `warnings`. mtgtop8 drops such cards silently, which corrupts the counts.
    *   **Common rules:**
        *   Split cards are written `A // B` in MTGA, `A/B` in MTGO and `A / B` in `.dec`.
        *   Double-faced and adventure cards are written by their front-face name.
        *   Cards are ordered by `group-by-type` (item 34).
        *   The text is UTF-8. mtgtop8 serves ISO-8859-1, but non-ASCII names were not sampled.
        *   The layout samples in `conformance/layout-samples/mtgtop8/` are a reference only. Conformance cases (item 41) re-create each sample deck with fixture cards. The comparison skips the `.dec` first comment line and compares the cards as a set.

#### 37. `packages/engine/src/version.ts`, `index.ts` (Create)

*   **Type / Scope**: Public API.
*   **Proposed Changes**: `version.ts` is generated by `prebuild` (item 24). `index.ts` re-exports the public functions and types.

#### 38. `packages/engine/test/*.test.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**:

    | Test file | Covers |
    |---|---|
    | `yaml.test.ts` | the 64 KB and depth-10 limits, alias rejection, the "Norway problem" (YAML 1.1 reads a bare `no` as false, and YAML 1.2 must keep it as a string), line numbers for keys |
    | `front-matter.test.ts` | missing block, unterminated block, `W-FRONTMATTER-UNKNOWN-FIELD`, `E-SCHEMA-VERSION` before schema checks |
    | `decklist.test.ts` | every grammar case in item 16, the blank-line sideboard, `Companion`, repeated headers, CRLF, the 300-character and 250-line limits |
    | `normalize-name.test.ts` | accents, curly quotes, every split-card spelling |
    | `format-key.test.ts` | the same key when keys or list items are reordered, a different key when a banlist changes, `#mtgjson` for official formats |
    | `resolve.test.ts` | every default-printing tie-break, unknown card with suggestions, unknown printing, a printing of a different card |
    | `validate.test.ts` | banned, not in pool, restricted, copies across main and sideboard, basic-land exemption, any-number exemption (for example Relentless Rats, whose text allows any number of copies), sizes, `E-DECK-SECTION`, the official legality mapping |
    | `group-by-type.test.ts` | group order, the Land rule, order within a group |
    | `diff.test.ts` | removed, added, count, printing, a default printing against an explicit one, section moves, sort order |
    | `export.test.ts` | `W-MTGA-UNAVAILABLE`, line endings, split and double-faced names |

#### 39. `packages/conformance/package.json`, `tsconfig.json`, `src/index.ts`, `src/run.ts`, `src/fake-lookup.ts` (Create)

*   **Type / Scope**: A private shared test package.
*   **Proposed Changes**: Package `@tcg-gauntlet/conformance`. It depends on `engine`.
    *   **`runConformance(lookup, {casesDir})`:** for each case folder, it:
        1. Parses `deck.txt`.
        2. Resolves the format from `case.json` (preset files are read from `presets/`).
        3. Resolves and validates the deck.
        4. Compares the result with `case.json`.
        5. Compares exports with any `expected.*` files, byte for byte.

        It returns a list of mismatches.
    *   **`fakeLookup(cardsJsonPath)`:** an in-memory `CardLookup` built from `conformance/fixtures/cards.json`.
    *   **Used by:** engine tests (item 40), carddata tests (item 50), validator tests (item 62) and the canary (item 13).

#### 40. `packages/engine/test/conformance.test.ts` (Create)

*   **Type / Scope**: Conformance run against the fake lookup.
*   **Proposed Changes**: Calls `runConformance(fakeLookup(...))`, and fails on any mismatch.

#### 41. `conformance/README.md`, `conformance/cases/*/`, `conformance/fixtures/cards.txt` (Create)

*   **Type / Scope**: Golden corpus.
*   **Proposed Changes**:
    *   **Case folders:** each case is a folder holding `deck.txt` and `case.json`.
        *   `case.json` has the shape `{format, expectedViolations: [{code, line?}], expectedPrintings: {"<line>": "SET/NUM"}}`.
        *   A case may also hold `expected.mtgo.txt`, `expected.dec` or `expected.mtga.txt`.
    *   **Required cases:**
        *   legal 2015 Modern Jund, Affinity and Burn decks, each with export files
        *   one deck each with Treasure Cruise (banned), Golgari Grave-Troll (legal), Cloudpost (banned) and a card printed after ORI (not in pool)
        *   a deck with 61 main-deck cards and 16 sideboard cards
        *   a deck with 5 Lightning Bolts across main deck and sideboard
        *   split and double-faced names
        *   unknown-card typos
        *   an `official:modern` deck
        *   an `official:vintage` deck with a restricted card
        *   a `Commander` section (`E-DECK-SECTION`)
        *   pasted Arena, MTGO and Moxfield lists (`paste-arena`, `paste-mtgo`, `paste-moxfield`)
        *   the three mtgtop8 layouts, re-created from spike 3
    *   **`cards.txt`:** lists every card name the cases use. It is the input for item 42.
    *   **README:** explains how to add a case and how to regenerate the fixtures.

#### 42. `scripts/build-fixtures.ts`, `conformance/fixtures/mini-allprintings.sqlite`, `conformance/fixtures/cards.json` (Create)

*   **Type / Scope**: Fixture generation.
*   **Proposed Changes**:
    *   **Command:** `node scripts/build-fixtures.ts --mtgjson <path to AllPrintings.sqlite>`.
    *   **Selection:** it copies every row for the cards in `cards.txt`, and for their sets, from a real MTGJSON file into `mini-allprintings.sqlite`, which keeps the same tables and columns.
    *   **JSON fixture:** it writes the same data as `cards.json` for the fake lookup.
    *   **Version control:** both outputs are committed. The canary (item 13) rebuilds them and fails if they differ.

### Phase 4 — `packages/carddata`

#### 43. `packages/carddata/package.json`, `tsconfig.json`, `src/mtgjson-queries.ts` (Create)

*   **Type / Scope**: Package config, and the only module that knows MTGJSON's SQL schema.
*   **Proposed Changes**:
    *   **Package:** `@tcg-gauntlet/carddata`. Dependencies: `better-sqlite3`, `@types/better-sqlite3` (dev), `lru-cache` and `@tcg-gauntlet/engine`.
    *   **`mtgjson-queries.ts`:** exports these prepared statements, all built on the attached schema `mtg`. Table and column names come from spike 1.
        *   `printingsByName(name)`
        *   `printingBySetNumber(set, number)`
        *   `lowestNumberInSet(set, name)`
        *   `officialLegality(column, name)`
        *   `insertPool(formatKey, setsJson)`: an `INSERT … SELECT` using the Technical Plan's pool filter
        *   `insertDefaultPrinting(formatKey, setsJson | null)`: an `INSERT … SELECT` using a `ROW_NUMBER() OVER (PARTITION BY name ORDER BY <the Default printing order>)` window
        *   `allCardNamesAndFaces()`
        *   `cardCount()`, which counts distinct names

#### 44. `packages/carddata/src/self-check.ts` (Create)

*   **Type / Scope**: Safety check.
*   **Proposed Changes**: `selfCheck(db, {minCards = 20000})`.
    *   It checks that every table and column the queries in item 43 use exists, using `PRAGMA mtg.table_info`.
    *   It checks that `cardCount()` is at least `minCards`. Tests pass `{minCards: 100}`.
    *   It returns a list of problems. A refresh fails if that list is not empty.

#### 45. `packages/carddata/src/download.ts` (Create)

*   **Type / Scope**: Network I/O.
*   **Proposed Changes**:
    *   **`fetchMeta(baseUrl)`:** reads `Meta.json`, whose shape is `{meta: {date, version}, data: {date, version}}`, and returns `{version: data.version, date: data.date}`, for example `5.3.0+20261115`. MTGJSON's server may cache `Meta.json` for up to 16 hours, so a newer build can show up late.
    *   **`downloadAllPrintings(baseUrl, tmpDir)`:**
        *   `tmpDir` is inside `DATA_DIR`, so the final rename stays on one filesystem.
        *   It streams `AllPrintings.sqlite.gz` through `zlib.createGunzip()` to `AllPrintings.sqlite.partial`, computing SHA-256 of the unpacked file as it goes.
        *   It fetches `AllPrintings.sqlite.gz.sha256` and `AllPrintings.sqlite.sha256`, each a bare 64-character hex value, and checks both the `.gz` and the unpacked file against them. Spike 1 confirmed both files exist. A mismatch is a `corrupt-archive` error.
        *   It returns the path and the checksum.
    *   **Requests:** send `User-Agent: tcg-gauntlet/<version>`. The time limit is 10 minutes.
    *   **Errors:** typed as `network`, `http-status` or `corrupt-archive`.

#### 46. `packages/carddata/src/cache.ts` (Create)

*   **Type / Scope**: Disk cache.
*   **Proposed Changes**:
    *   **Layout:**
        *   The card data lives at `DATA_DIR/mtgjson/<v>-<d>/AllPrintings.sqlite`. `<v>` is the version with `+` replaced by `_`, and `<d>` is the date.
        *   The index is `DATA_DIR/mtgjson/current.json`, holding `{version, date, sha256, path, previous}`. `previous` is an object of the same shape, or `null`.
    *   **Atomic writes:** write a temporary file, `fsync` it, `rename` it on the same filesystem, then `fsync` the directory. This applies to every file this package writes, and to `history.sqlite` (item 66).
    *   **Retention:** keeps the current and previous versions, and deletes the rest.
    *   **Startup check:** recomputes the checksum of the current file. On a mismatch, it marks the file corrupt and triggers a refresh.

#### 47. `packages/carddata/src/derived.ts` (Create)

*   **Type / Scope**: Derived index.
*   **Proposed Changes**:
    *   **Connection:** opens `DATA_DIR/derived/<v>-<d>.sqlite` read-write as the main connection, with the default rollback journal. It then runs `ATTACH 'file:<path>/AllPrintings.sqlite?mode=ro' AS mtg`.
    *   **Tables:**
        *   `meta(key, value)` holds `tool_schema` and the MTGJSON version.
        *   `formats(format_key PRIMARY KEY, built_at)`.
        *   `format_pool(format_key, name, PRIMARY KEY(format_key, name))`.
        *   `default_printing(format_key, name, uuid, PRIMARY KEY(format_key, name))`. It is filled for every format key in use, official ones included.
        *   `card_names(norm_name PRIMARY KEY, name, face_name)`.
        *   `card_names_fts`: a virtual FTS5 table over `norm_name` with `tokenize='trigram'`.
        *   `card_meta(name PRIMARY KEY, supertypes, layout, copy_exempt)`, where `copy_exempt` is computed from supertypes and from the rules text "A deck can have any number of cards named". MTGJSON's `hasAlternativeDeckLimit` is not used, because it also marks cards with a different limit, such as Nazgûl and Seven Dwarves.
    *   **`buildBase()`:** runs once per MTGJSON version. It fills `card_names` (using the engine's `normalizeName`), `card_names_fts` and `card_meta`.
    *   **`ensureFormats(defs)`:** builds any missing format keys, one transaction per format.
    *   **`pruneFormats(keepKeys)`:** deletes unused format keys.
    *   **Rebuild rule:** an unknown `tool_schema` value means the file is deleted and rebuilt.

#### 48. `packages/carddata/src/lookup.ts` (Create)

*   **Type / Scope**: `CardLookup` implementation.
*   **Proposed Changes**: `SqliteCardLookup` uses prepared statements, with an `lru-cache` cache of 10,000 entries for `findCard`.
    *   **`findCard(name)`:** normalises the name and looks it up in `card_names`.
    *   **`suggest(name, limit)`:** queries `card_names_fts` with `MATCH`, ranks by `bm25`, and returns the top `limit` names. No hand-written edit distance is used.

#### 49. `packages/carddata/src/refresh.ts`, `index.ts` (Create)

*   **Type / Scope**: Orchestration.
*   **Proposed Changes**:
    *   **`refreshCardData({baseUrl, dataDir, formatDefs, force, minCards})`:** runs the six-step refresh cycle from the Technical Plan. It returns `{status: 'updated' | 'unchanged' | 'failed', error?, current}`.
    *   **`openCurrent(dataDir)`:** returns `{ok: true, lookup} | {ok: false, reason: 'no-data' | 'corrupt'}`.

#### 50. `packages/carddata/test/*.test.ts` (Create)

*   **Type / Scope**: Tests. They use `conformance/fixtures/mini-allprintings.sqlite`.
*   **Proposed Changes**:

    | Test | Checks |
    |---|---|
    | `self-check` | Fails on a missing column. Passes with `minCards: 100`. |
    | `derived` | Builds base, pool and default-printing rows, and is idempotent. |
    | `lookup` | `runConformance(new SqliteCardLookup(...))` gives no mismatches. `suggest` returns the expected names for three typos. |
    | `cache` | Retention of two versions. A startup checksum mismatch triggers a refresh. |
    | `refresh` | Against a local HTTP server: Meta unchanged, new version, corrupt `.gz`, and a failed self-check that keeps the old version. |

*   **As built (Phase 4):**
    *   **SQLite library:** `better-sqlite3` 13.2.0 works with `onlyBuiltDependencies`. It opens connections without URI support, so `ATTACH 'file:…?mode=ro'` fails unless `SQLITE_USE_URI=1` is set before its first connection. `derived.ts` sets it at import time, then checks that the attach is read-only and fails with a clear message if not. Any process that opens a SQLite file before importing `@tcg-gauntlet/carddata` must set `SQLITE_USE_URI=1` itself (the app, Phase 7).
    *   **Queries:** `mtgjson-queries.ts` also holds `insertCardMeta`, `metaVersion` and `printingByUuid`. It registers one SQL function, `tcg_num_part`, for the numeric part of a collector number.
    *   **Default printing:** `default_printing` has a row for every card name with a qualifying printing, not only pool members, so it matches the fake lookup for banned cards too. A custom format fills it twice, first from its sets and then from any set for cards that have no row yet.
    *   **Pool:** `insertPool` takes the resolved `include`, `exclude` and `banned` names as JSON, so a format build needs no temporary tables.
    *   **Lookup:** `new SqliteCardLookup(derived)` takes an open `Derived`. `registerFormat` builds a custom format on demand. Official format keys are built on first use. `poolSize(formatKey)` was added. `suggest()` ORs the trigrams of the input in an FTS5 `MATCH`, ranks by `bm25`, and drops candidates that share under 30% of the input's trigrams.
    *   **Cache:** `current.json` may hold `corrupt: true`. The startup check sets it, and the next refresh replaces the file even when `Meta.json` shows the same version. `tmp/` inside `DATA_DIR` holds downloads, and a refresh clears it first, so one refresh may run at a time.
    *   **Errors:** `CardDataError.kind` is `network`, `http-status`, `corrupt-archive`, `bad-meta`, `self-check` or `build`.
    *   **Refresh:** the derived file is built in `tmp/` against the downloaded file, then both files are moved into place before `current.json` changes. `openCurrent` is async because it hashes the file, and returns `current` as well as `lookup`.
    *   **Canary:** `packages/carddata/scripts/canary.ts` has the `refresh` and `conformance` commands that the workflow runs. It also serves as the manual end-to-end check.
    *   **Real data (MTGJSON 5.3.0+20261115):** a refresh into an empty data directory took 13.4 s on a developer machine, including the 227 MB download. The derived file is 13.7 MiB, built in about 1.7 s. The 2015 Modern pool has 9,186 names. The conformance corpus passes against the full file, and regenerating the fixtures from it gives byte-identical files.

### Phase 5 — `packages/repo` (shared deck-repo access)

#### 51. `packages/repo/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts` (Create)

*   **Type / Scope**: Package config and types.
*   **Proposed Changes**:
    *   **Package:** `@tcg-gauntlet/repo`. Dependencies: `@tcg-gauntlet/engine` and `yaml`.
    *   **`types.ts`:**
        *   `RepoContents` is `{gauntlets: {folder, yamlText, mdText?, decks: {path, name, text, primer?}[]}[], formats: {path, text}[], errors: Violation[]}`.
        *   `Change` is `{status: 'A'|'M'|'D'|'R', path, oldPath?}`.

#### 52. `packages/repo/src/git.ts` (Create)

*   **Type / Scope**: Git wrapper.
*   **Proposed Changes**:
    *   **Execution:** uses `execFile('git', args, {env, maxBuffer: 64 MB})`. The environment and `-c` flags are exactly the list in Security.
        *   `env` starts from `PATH` and `LANG` taken from `process.env`, plus `HOME=<dataDir>/home`.
        *   Test mode applies the protocol changes listed in Security.
    *   **Functions:**

        | Function | Behaviour |
        |---|---|
        | `clone(url, dir)` | Runs with `--no-recurse-submodules`. |
        | `fetch` | Fetches the tracked branch. |
        | `resetHard` | Resets the working tree to the fetched commit. |
        | `lsRemote` | Returns `{sha}`, or `{error, throttled: boolean}`. `throttled` is true when stderr matches `/\b(429\|5\d\d)\b/`. |
        | `revParse` | Resolves a revision to a commit SHA. |
        | `isAncestor(a, b)` | A missing object returns `false`. |
        | `diffNameStatus(base, head)` | Runs `git diff --name-status -z -M <base>...HEAD`. Returns `Change[]`. |
        | `logHistory(range)` | Runs the history pass from the Technical Plan. Returns parsed records. |
        | `catFile` | One long-lived `git cat-file --batch` process. `read(sha) → Promise<string>`. |
        | `isRepoHealthy()` | Runs `git fsck --connectivity-only` with a 60 s timeout. |

#### 53. `packages/repo/src/scan.ts` (Create)

*   **Type / Scope**: Repo scanner.
*   **Proposed Changes**: `scanRepo(dir) → RepoContents`.
    *   Follows the rules in item 17.
    *   Enforces the file-size, decks-per-gauntlet and name-collision limits, and refuses symlinks, using `lstat`.
    *   Line and depth limits are enforced by the engine parsers (item 26).

#### 54. `packages/repo/src/affected.ts` (Create)

*   **Type / Scope**: Change detection.
*   **Proposed Changes**: `affectedDecks(changes: Change[], contents) → deckPath[]`.
    *   A changed deck `.txt` or primer `.md`: that deck. For an `R` change, the new path.
    *   A changed `gauntlet.yaml` or `gauntlet.md`: every deck in that gauntlet.
    *   A changed `formats/<f>.yaml`: every deck in every gauntlet whose format is `repo:formats/<f>.yaml`.
    *   A `D` change on its own selects nothing.

#### 55. `packages/repo/src/formats.ts` (Create)

*   **Type / Scope**: Format resolution.
*   **Proposed Changes**: `resolveFormat(gauntletDef, contents, presetsDir) → {key, rules} | Violation`.
    *   **Presets:** loaded from `presetsDir`. It defaults to `PRESETS_DIR`, which the images set to `/app/presets`.
    *   **Repo formats:** a `repo:` path outside `formats/` gives `E-FORMAT-UNKNOWN`.

#### 56. `packages/repo/test/*.test.ts` (Create)

*   **Type / Scope**: Tests.
*   **Proposed Changes**:
    *   **Setup:** temporary repos made with `git init -b main`, with `user.name` and `user.email` set, and cloned over `file://` in test mode.
    *   **Coverage:**
        *   scanning, limits, symlink refusal and case collisions
        *   `affectedDecks` for A, M, D and R changes, and for format files
        *   `logHistory`:
            *   renames across 5 commits between two runs
            *   delete, then re-add
            *   merge commits under `--first-parent`
            *   a full rebuild and an incremental update giving identical `seq` values
        *   `isAncestor` after a force-push, including a missing object

*   **As built (Phase 5):**
    *   **Git wrapper:** a `Git` class (`new Git({dataDir, testMode})`). Every method takes the repo directory first, because `-c safe.directory=<repo dir>` is on every call. `gitEnv()` and `gitConfigArgs()` are exported, so tests check the exact list.
        *   `lsRemote(dir, branch)` runs `git ls-remote origin refs/heads/<branch>` in the clone, not against a URL.
        *   `fetch(dir, branch)` uses a forced refspec into `refs/remotes/origin/<branch>`, so a force-push does not fail the fetch. `resetHard(dir, rev)` takes the SHA or ref to reset to.
        *   `logHistory(dir, range)` passes `-c diff.renameLimit=0` and the `%at` field. It parses the output token by token (NUL separated), so a `\x1e` or `\x1f` in a subject or a path cannot split a record.
        *   `diffNameStatus(dir, base, head = "HEAD")` takes the head as a parameter. Copies (`C`) become `A` and type changes (`T`) become `M`.
        *   `catFile(dir)` returns a `CatFile`. `read(sha)` accepts only a 40 or 64 digit hex id. A missing object rejects and the process keeps working.
        *   Branch names and revisions that start with `-` or contain unusual characters are rejected, so they cannot become git options.
        *   Timeouts: 10 minutes for clone and fetch, 60 s for `ls-remote` and `fsck`.
    *   **History rules:** `applyHistory(records, prior)` in `history.ts` is pure. `prior` is `{lastSeq, maxDeckId, liveDecks}`. It returns the `decks` created or changed (with their final `current_path`), the `deck_versions` rows, `lastSeq` and `maxDeckId`. The persister must set `current_path` to NULL for all returned decks before writing the new values, because a deck can take a path another deck in the same batch gives up. `maxDeckId` is the largest id ever issued, dead decks included, so ids match between a full and an incremental run. Choosing between full and incremental (the `isAncestor` test, the range) is left to Phase 7's `history.ts`. The tests show the sequence.
    *   **`resolveFormat`:** it is async, because the format key is hashed with `crypto.subtle`. The signature is `resolveFormat({format}, {formats}, {presetsDir?, lookup?, file?})`. It returns the resolution (`{ref, key, def, rules}`) or `{violations: Violation[]}`, a list rather than one violation, because a definition can break several rules. `isFormatFailure()` tells them apart. `lookup` is optional, and without it the card-name check of `checkFormatDef` is skipped (the app and the validator pass their card lookup). A missing presets directory throws, because it is a configuration error and not a verdict on the deck repo.
    *   **Scan:** the rules for files over a limit are pinned in `spec/gauntlet.md`. Orphan primers are reported as `W-PRIMER-ORPHAN` in `RepoContents.errors`, so that list holds warnings too.
    *   **`affectedDecks`:** deleting a deck or gauntlet file selects nothing, because nothing is left to check. Deleting a format file selects every deck whose gauntlet still refers to it, so CI reports `E-FORMAT-UNKNOWN` and blocks the delete. (Changed after review: the first version let such a delete pass CI.) Results are in byte order.
    *   **Dependencies:** `yaml` is declared as the design says, but nothing in `packages/repo` imports it, because the engine's parsers do all the YAML work.
    *   **Tests:** 81 tests in 5 files. The history tests port the spike's checks (a1, eight a2 cases, a3, b1, b2, c, d1, d2, e, f) onto a generated repo of 110 steps, and take about 2 s. Branch coverage of `packages/repo/src` is 89.9%.

### Phase 6 — `packages/validator`

#### 57. `packages/validator/package.json`, `tsconfig.json`, `src/index.ts` (Create)

*   **Type / Scope**: Package config.
*   **Proposed Changes**:
    *   **Package:** `@tcg-gauntlet/validator`, with `bin: {"tcg-gauntlet-validate": "./dist/cli.js"}`.
    *   **Dependencies:** engine, carddata, repo and `@actions/core`.
    *   **Bundled template:** the package includes `template/`, copied in at build time, for `init`.

#### 58. `packages/validator/src/cli.ts`, `src/init.ts` (Create)

*   **Type / Scope**: CLI.
*   **Proposed Changes**:
    *   **Commands:** `validate` (the default) and `init`.
    *   **Arguments:** parsed with `node:util` `parseArgs`. Defaults: `--repo .`, `--data-dir ./.tcg-gauntlet-cache`, `--output text`.
    *   **Usage errors (exit 2):**
        *   neither `--changed-since` nor `--all`, or both
        *   a `--changed-since` ref that doesn't resolve
    *   **`validate` steps:**
        1. `scanRepo`.
        2. Parse every `gauntlet.yaml`, and run `resolveFormat` for each.
        3. Run `refreshCardData` with those definitions.
            *   If it fails but cached data exists, continue on the cached data and add `W-STALE-DATA`.
            *   If it fails with no usable data, exit 2.
        4. Select the decks: all of them, or the result of `affectedDecks(diffNameStatus(...))`.
            *   An empty selection prints "no decks affected" and exits 0.
        5. Parse, resolve and validate each selected deck.
        6. Print the results and exit with the code from item 19.
    *   **`init [--format <ref>]`:**
        *   Copies the bundled template into `--repo`, without overwriting existing files.
        *   Sets the template's `gauntlet.yaml` format to `<ref>`.
        *   Prints the next steps, including branch protection.

#### 59. `packages/validator/src/output/{text,json,github}.ts` (Create)

*   **Type / Scope**: Formatters.
*   **Proposed Changes**:
    *   **Text:** grouped by file, as `path:line CODE message (did you mean …)`.
    *   **JSON:** `{engineVersion, mtgjson, results: [{path, formatKey, violations}]}`.
    *   **GitHub:**
        *   Annotations go through `core.error` for `E-` codes and `core.warning` for `W-` codes. Each has `{file, startLine, title: code}`, and `@actions/core` escapes the messages.
        *   File paths are relative to the workspace.
        *   GitHub shows only a limited number of annotations. The full result table therefore always goes to the step summary through `core.summary`.

#### 60. `packages/validator/Dockerfile` (Create)

*   **Type / Scope**: Container image.
*   **Proposed Changes**:
    *   **Build stage:** `node:22-bookworm-slim` with `python3 make g++`. Runs `pnpm install --frozen-lockfile`, `pnpm -r build`, then `pnpm --filter @tcg-gauntlet/validator deploy --prod /out`.
    *   **Runtime stage:** `node:22-bookworm-slim` with `git` and `ca-certificates`.
        *   Copies `/out` to `/app`.
        *   Copies `presets/` to `/app/presets`, and sets `ENV PRESETS_DIR=/app/presets`.
        *   Links `/app/dist/cli.js` as `/usr/local/bin/tcg-gauntlet-validate`.
        *   Runs as `USER node`.
        *   The entrypoint is `tcg-gauntlet-validate`.

#### 61. `actions/validate/action.yml` (Create)

*   **Type / Scope**: Composite GitHub Action.
*   **Proposed Changes**:
    *   **Inputs:**
        *   `all`: default `false`.
        *   `data-dir`: default `${{ runner.temp }}/tcg-gauntlet-cache`.
    *   **Steps:**
        1. **Pick the comparison base.**
            *   For pull requests: `git merge-base origin/${{ github.base_ref }} HEAD`.
            *   For pushes: `${{ github.event.before }}`.
            *   If the base is all zeros or can't be resolved, use `--all`.
            *   Compute the week with `date +%G-%V`.
        2. **Restore the cache.** `actions/cache/restore`, keyed `tcg-gauntlet-mtgjson-<week>` with the restore key `tcg-gauntlet-mtgjson-`.
        3. **Run the validator.**

            ```text
            docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp
              -v "$GITHUB_WORKSPACE:/github/workspace" -w /github/workspace
              -v "<data-dir>:/cache"
              -v "$GITHUB_STEP_SUMMARY:/github/summary" -e GITHUB_STEP_SUMMARY=/github/summary
              -e GITHUB_ACTIONS=true
              <image@digest, written by the release> --data-dir /cache --output github <--changed-since base | --all>
            ```

        4. **Save the cache.** `actions/cache/save` with `if: always()`.

#### 62. `packages/validator/test/cli.test.ts` (Create)

*   **Type / Scope**: Integration tests.
*   **Proposed Changes**: These tests run the CLI on fixture repos, using the mini MTGJSON fixture served from a local HTTP server. They check:
    *   exit codes 0, 1 and 2, and every usage error
    *   the text, JSON and GitHub formatters
    *   the warm-cache fallback, which gives `W-STALE-DATA` and exits 0 or 1
    *   the affected-deck selection
    *   `init` into an empty folder
    *   that `runConformance` gives the same verdicts through the CLI as through the engine

*   **As built (Phase 6):**
    *   **Package layout:** `src/cli.ts` (`runCli(argv, io)` returns the exit code, and a guard runs it only when the file is the program), `validate.ts` (the six steps), `init.ts`, `types.ts`, `output/{text,json,github}.ts`, and `index.ts`, which re-exports them. Tests call `runCli` in process, so coverage sees it, and one test also runs the built `dist/cli.js` as a program. `dist/template` is a copy of `template/`, made by `scripts/copy-template.ts` (it also sets the executable bit on `dist/cli.js`). Running from source, `init` falls back to the repo's `template/`.
    *   **Presets folder:** `--presets-dir`, then `PRESETS_DIR`, then `presets/` of the monorepo checkout the file is in (`../../../presets` from `dist/` or `src/`). The last default works only when running from a checkout. The image sets `PRESETS_DIR=/app/presets`. A missing folder is a configuration error: exit 2 with a message.
    *   **Environment:** `MTGJSON_BASE_URL` (default `https://mtgjson.com/api/v5`) is read, as in the app. `TCG_GAUNTLET_MIN_CARDS` is a test-only knob that lowers the self-check minimum (the mini fixture has about 100 cards). It is not documented to users.
    *   **Order of the steps:** a `--changed-since` ref is resolved (and the diff taken) before the scan, so a bad ref is exit 2 without any network traffic. The formats of all gauntlets are resolved before the refresh, without a card lookup, because the refresh needs the definitions. The card-name check of a custom format (`E-FORMAT-INVALID`) runs after the refresh, in a second `resolveFormat` call with the lookup. `openCurrent` always follows the refresh. It skips the checksum when the refresh just downloaded the file. If it fails, the run exits 2.
    *   **What is checked with `--changed-since`:** besides the decks `affectedDecks` selects, a gauntlet is reported when any file in its folder changed (so a broken `gauntlet.yaml` with unchanged decks is still reported), and a changed `formats/*.yaml` is validated by itself even when no gauntlet uses it. Scan problems (`E-LIMIT-EXCEEDED`, `W-PRIMER-ORPHAN`) are reported when their file changed or is a selected deck. The decks of a gauntlet whose `gauntlet.yaml` or format failed are not checked, and are not listed.
    *   **Report and output:**
        *   JSON is `{engineVersion, mtgjson: {version, date} | null, results}` exactly. `results` has every checked deck (an empty `violations` list when it passes, and its `formatKey`) and every other file with a problem (`formatKey: null`). `W-STALE-DATA` is in a result with `path: ""`. Results are in byte order of the path.
        *   Text prints the file name, then one `  path:line CODE message (did you mean …)` line per violation, then `N decks checked, N errors, N warnings.` It prints `No decks affected.` when no deck was checked.
        *   GitHub output sends annotations through `core.error` and `core.warning`, with `file` relative to `GITHUB_WORKSPACE` when `--repo` is inside it, and `title` set to the code. The step summary gets a heading, a count line and a table of the checked decks and failing files, written only when `GITHUB_STEP_SUMMARY` is set. Text from deck repos is HTML-escaped in the table.
    *   **`init`:** never touches an existing file, even a symlink, and `--format` rewrites the `format:` line only in a copy it wrote. A bad `--format` is a usage error. `init` rejects the `validate` flags and `validate` rejects `--format`.
    *   **Dockerfile (not built here):** the build stage installs and builds only `@tcg-gauntlet/validator...` (`--filter`), not the whole workspace, so the image does not build the app. `pnpm` comes from `corepack enable`, which reads `packageManager`. The `.dockerignore` patterns `node_modules` and `coverage` were made `**/node_modules` and `**/coverage`, because the old ones matched only the context root, so `COPY packages` would have copied the packages' `node_modules`. `docker build` could not be run where this was written (permission denied on the Docker socket), so the first real build is the CI job.
    *   **Action:** the `data-dir` input defaults to an empty string and the step uses `$RUNNER_TEMP/tcg-gauntlet-cache` then, because the `runner` context is not available in an input default. The cache is saved with `if: always() && cache-hit != 'true'`, because saving a key that exists fails. The container also gets `GITHUB_WORKSPACE=/github/workspace`, so annotation paths are relative to the workspace. `actions/cache` is used at `v5`, matching the major versions the other workflows use.
    *   **CI:** two jobs were added to `ci.yml`. `validator-image` builds the image, then runs it on `template/` with `--all` (card data downloaded from MTGJSON and cached by week with `actions/cache`), the way the Action runs it, and then runs `init` into an empty folder and validates the result. Running the built image instead of `node dist/cli.js` also tests the Dockerfile's runtime stage. `ci-timing` builds the image again, runs it on `template/` with an empty cache and then with it warm, writes both times to the job summary, and fails if the warm run takes over 60 s.
    *   **Real data (MTGJSON 5.3.0+20261115):** `init` into an empty folder, then `validate --all`: 12.1 s cold (empty data dir, download of 227 MB included), 1.6 s warm. Developer machine.
    *   **Tests:** 49 tests in `test/cli.test.ts`. Branch coverage of `packages/validator/src` is 92%. The parity test builds a repo from all 30 conformance cases (one gauntlet per format reference) and compares the codes and lines the CLI reports with each `case.json`, then runs `runConformance` over the same data dir.
    *   **For later phases:** the template files hold the placeholder `__ACTION_REF__`, and the Action holds `__VALIDATOR_IMAGE__`, so neither works until a release has replaced them. `template/` content (items 75–77) was written in this phase. Phase 8 only reviews it.

### Phase 7 — `packages/app`

#### 63. `packages/app/package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`, `src/app.html`, `src/app.d.ts` (Create)

*   **Type / Scope**: SvelteKit app config.
*   **Proposed Changes**:
    *   **Package:**
        *   Name `@tcg-gauntlet/app`, with `"files": ["build"]` so that `pnpm deploy` includes the build.
        *   Dependencies: `@sveltejs/kit`, `@sveltejs/adapter-node`, `@sveltejs/vite-plugin-svelte`, `svelte`, `vite`, `better-sqlite3`, `markdown-it`, `@types/markdown-it`, `pdf-lib`, `lru-cache`, plus the engine, carddata and repo packages.
        *   Dev dependencies: `svelte-check` and `@playwright/test`.
        *   Scripts: `build`, `typecheck` (`svelte-check`), and `e2e` (`playwright test`).
    *   **`tsconfig.json`:** extends `./.svelte-kit/tsconfig.json`.
    *   **CSP:** `svelte.config.js` sets `kit.csp`, with `mode: 'auto'` and the directives from the Security section.
    *   **Playwright:** `playwright.config.ts` points at `e2e/`, with a `baseURL` taken from `E2E_BASE_URL`.

#### 64. `packages/app/src/lib/server/config.ts` (Create)

*   **Type / Scope**: Config.
*   **Proposed Changes**: Parses the environment variables from the Technical Plan table into a frozen object.
    *   **Integer ranges:**

        | Variable | Range |
        |---|---|
        | `POLL_INTERVAL_SECONDS` | 10–3600 |
        | `MTGJSON_REFRESH_HOURS` | 1–168 |
        | `IMAGE_CACHE_MAX_MB` | 50–100000 |
        | `HISTORY_MAX_VERSIONS` | 1–10000 |
        | `PORT` | 1–65535 |

    *   **Boolean values:** `ALLOW_INSECURE_TEST_REPO_URL` accepts `1` or `true` only.
    *   **URL check:** `DECK_REPO_URL` is checked against the grammar, or against the test-mode rules.
    *   **Errors:** on invalid values, startup fails with one message per variable.

#### 65. `packages/app/src/lib/server/logger.ts`, `status.ts` (Create)

*   **Type / Scope**: Observability.
*   **Proposed Changes**:
    *   **Logger:** writes JSON lines to stdout, with the fields `ts`, `level`, `msg`, `commit`, `path`, `durationMs` and `err`.
    *   **Status store:**
        *   **Last sync:** commit, started, finished, duration and error.
        *   **Failure state:** `consecutive_failures` and `stale_since`.
        *   **Card data:** version, date, sha256, last check and error.
        *   **Formats:** the format keys built.
        *   **History:** its state, `ready` or `building`.
        *   **Disk:** free space, from `fs.statfs(DATA_DIR)`.
        *   **Webhook:** its URL, `PUBLIC_BASE_URL` + `/webhook/github`.
        *   **Engine:** its version.

#### 66. `packages/app/src/lib/server/history-db.ts`, `history.ts` (Create)

*   **Type / Scope**: History store.
*   **Proposed Changes**:
    *   **`history-db.ts`:**
        *   Defines `meta(tool_schema)`, `sync_state(key PRIMARY KEY, value)` (which holds `last_commit` and `last_seq`), and the `decks` and `deck_versions` tables from the Technical Plan, with their keys and indexes.
        *   The handle is reopened after a full rebuild's rename.
    *   **`history.ts`:**
        *   `updateHistory(git, db, newHead)` runs an incremental update or a full rebuild, following the Technical Plan rules.
            *   A full rebuild writes `history.sqlite.tmp` and renames it into place (atomic write as in item 46).
            *   A missing `last_commit` object counts as a force-push.
        *   `versions(currentPath, limit)` reads the rows for the deck's `deck_id`, newest first.
        *   `content(blobSha)` returns the parsed version, using `catFile` and a 500-entry `lru-cache`. A version that doesn't parse comes back with its raw text.
        *   `lastUpdated(currentPath)` returns the newest `author_date` across the deck's `txt` and `md` rows.

#### 67. `packages/app/src/lib/server/snapshot.ts` (Create)

*   **Type / Scope**: In-memory model.
*   **Proposed Changes**:
    *   **`buildSnapshot(contents, lookup, history) → Snapshot`:**
        *   The snapshot is frozen. It holds `commit`, `gauntlets[]` (each with its definition, format key, errors and `decks[]`), and per deck:
            *   the resolved deck
            *   its grouping
            *   its violations
            *   the rendered primer HTML
            *   the last-updated date
        *   It also holds the set of allowed `scryfallId`s, each with a `hasBackFace` flag.
    *   **`getSnapshot()` and `setSnapshot()`:** swap the snapshot by reference.

#### 68. `packages/app/src/lib/server/sync.ts` (Create)

*   **Type / Scope**: Sync loop.
*   **Proposed Changes**:
    *   **`startSync(config)`:** runs the seven-step sync from the Technical Plan. A single-flight flag plus a "run again" flag guard it. A sync that runs again fetches the latest SHA.
    *   **Cold start:**
        1. Clone and `refreshCardData` run in parallel.
        2. Then `ensureFormats` for formats first seen in the repo.
        3. Then a full history build.
        4. Then the first snapshot.
    *   **Timers:**
        *   The poll timer runs every `POLL_INTERVAL_SECONDS` with ±10% jitter.
        *   The refresh timer runs every `MTGJSON_REFRESH_HOURS`. When new card data arrives, the snapshot is rebuilt from the same commit.
    *   **Failures and backoff:**
        *   A failed sync, or a throttled `lsRemote`, waits 30 s × 2ⁿ, capped at 10 minutes. The next success resets the delay.
        *   `consecutive_failures` is updated, and `stale_since` is set on the first failure.
        *   When `fetch` fails, `isRepoHealthy` runs. If it fails, the clone is deleted and cloned again.
    *   **`triggerSync(reason)`:** the webhook's entry point.
    *   **`stopSync()`:** stops the timers and waits for the current sync, for at most 25 s.

#### 69. `packages/app/src/lib/server/markdown.ts`, `github-links.ts`, `webhook.ts`, `image-cache.ts`, `rate-limit.ts` (Create)

*   **Type / Scope**: Server helpers.
*   **Proposed Changes**:
    *   **`markdown.ts`:** markdown-it with `html: false` and `linkify: true`.
        *   `validateLink` allows `http:`, `https:`, `mailto:` and `#` anchors.
        *   Image tokens are removed.
        *   External links get `rel="noopener nofollow"`, and no `target`.
    *   **`github-links.ts`:** builds the edit, new-file, commit and blob URLs from the normalised `DECK_REPO_URL` and the branch. In test mode it uses the configured URL as the base.
    *   **`webhook.ts`:**
        *   The HMAC is computed over `await request.arrayBuffer()`, and compared with `crypto.timingSafeEqual`.
        *   Response codes:

            | Code | When |
            |---|---|
            | 404 | No secret is set. |
            | 401 | The signature is bad or missing. |
            | 202 | Accepted, or ignored because the event isn't `push` or `ping`, or the `ref` is not the tracked branch. |
            | 429 | More than one trigger in 5 seconds. |
    *   **`image-cache.ts`:**
        *   Fetches `https://cards.scryfall.io/large/<front|back>/<id[0]>/<id[1]>/<id>.jpg` with `redirect: 'error'`, at most 4 at once.
        *   Stores images as `DATA_DIR/images/<face>/<id[0]>/<id>.jpg`, using atomic writes.
        *   Each cache hit runs `fs.utimes` on the file. When the cache passes `IMAGE_CACHE_MAX_MB`, files are evicted oldest-mtime first.
    *   **`rate-limit.ts`:** a token bucket per client IP, at 120 requests per minute. The client IP comes from SvelteKit's `getClientAddress()`, which follows adapter-node's `ADDRESS_HEADER` and `XFF_DEPTH`.

#### 70. `packages/app/src/hooks.server.ts` (Create)

*   **Type / Scope**: Server hooks.
*   **Proposed Changes**:
    *   **`init`:** the server hook starts `startSync` once, unless `building` from `$app/environment` is true. This keeps the sync from running during `vite build`.
    *   **Shutdown:** `process.on('sveltekit:shutdown', stopSync)`. adapter-node's `SHUTDOWN_TIMEOUT` defaults to 30 s.
    *   **`handle`:** adds `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`, and logs each request.

#### 71. `packages/app/src/routes/**` (Create)

*   **Type / Scope**: Pages and endpoints.
*   **Proposed Changes**:

    | Route files | Behaviour |
    |---|---|
    | `+layout.server.ts`, `+layout.svelte` | Shared layout. Footer data and the stale banner come from status. |
    | `+error.svelte` | Common 404 and 503 page. |
    | `+page.server.ts`, `+page.svelte` | Gauntlet list. |
    | `g/[gauntlet]/+page.server.ts`, `+page.svelte` | Gauntlet page. |
    | `g/[gauntlet]/[deck]/+page.server.ts`, `+page.svelte` | Deck page. |
    | `g/[gauntlet]/[deck]/history/+page.*` | Version list for a deck. |
    | `g/[gauntlet]/[deck]/v/[commit]/+page.*` | One version. Accepts a full SHA or a short SHA of 7 or more characters. With `?compare=`, shows the diff. 404 unless the commit is in that deck's rows. |
    | `g/[gauntlet]/[deck]/export/[kind]/+server.ts` | `mtgo` gives `.txt` and `dec` gives `.dec`, as `text/plain; charset=utf-8` with `Content-Disposition: attachment; filename*=UTF-8''<encoded>`. Any other kind gives 404. |
    | `g/[gauntlet]/[deck]/export/mtga/+page.*` | MTGA text with a copy button and the list of cards not on Arena. |
    | `g/[gauntlet]/[deck]/proxies/+page.*` | Proxy-printing page. |
    | `img/[id]/[face]/+server.ts` | 404 unless `id` is in the snapshot allow-list, `face` is `front` or `back`, and `back` is only used for cards with a back face. 429 over the rate limit. Otherwise serves the cached JPEG with `Cache-Control: public, max-age=604800`. |
    | `webhook/github/+server.ts` | GitHub webhook. |
    | `healthz/+server.ts` | Alive check. |
    | `readyz/+server.ts` | Ready when a snapshot, card data and a derived index all exist. |
    | `status/+server.ts` | JSON from the status store. |

    Common rules:
    *   **Not ready:** until the first snapshot exists, every route except `healthz`, `readyz` and `status` answers 503. Pages show "Preparing data".
    *   **Unknown paths:** an unknown gauntlet, deck or commit gives 404.

#### 72. `packages/app/src/lib/components/*.svelte`, `src/lib/client/pdf.ts` (Create)

*   **Type / Scope**: UI.
*   **Proposed Changes**:
    *   **Components:**

        | Component | Shows |
        |---|---|
        | `CardGroup` | A type heading with a count, and rows of `count name`. |
        | `CardPreview` | A hover or tap preview of the `normal` image. |
        | `LegalityBadge` | Legality, the MTGJSON version used, and an expandable list of violations. |
        | `DiffTable` | The changes between two versions. |
        | `ExportMenu` | The export options. |
        | `StaleBanner` | "Content may be out of date since <time>". |
        | `Footer` | The page footer. |

    *   **`pdf.ts`:** `buildProxyPdf(entries, {paper: 'a4' | 'letter', cutLines: boolean, marginNote: boolean}) → Promise<Uint8Array>`.
        *   **Cards:** each card is repeated `count` times. A card with a back face adds its back as an extra card.
        *   **Images:** fetches `/img/<id>/<face>` four at a time and shows progress. Each unique image is embedded once, then drawn for every copy.
        *   **Layout:** a 3×3 grid at 63×88 mm, centred on the page, with each image scaled to fit and its aspect ratio kept.
        *   **Cut lines:** 0.2 mm marks on the card edges, extending into the margin.
        *   **Margin note:** "Proxy — not for sale" in 7 pt Helvetica, centred in the bottom margin.
        *   **Output:** the PDF is downloaded. There is no in-page preview.

#### 73. `packages/app/test/*.test.ts`, `packages/app/e2e/smoke.spec.ts`, `packages/app/e2e/fixture-repo/` (Create)

*   **Type / Scope**: Tests.
*   **Proposed Changes**:
    *   **Unit and integration tests (vitest):**

        | Area | Cases |
        |---|---|
        | `config` | Ranges and boolean values. |
        | `webhook` | Every response code, other events, other branches. |
        | `markdown` | `<script>` is escaped, `javascript:` links are dropped, images are removed, anchors are kept. |
        | `image-cache` and `rate-limit` | Unknown id returns 404. A `back` request for a single-faced card returns 404. Eviction, the concurrency limit and 429, using a stub upstream server. |
        | `history` | An incremental update equals a full rebuild. A force-push, including a missing object, triggers a rebuild. Renames, deletes, raw text for unparseable versions. |
        | `sync` | A failed fetch keeps the previous snapshot. A new format is built before the swap. Backoff, `stale_since` and the banner after 3 failures, checked with a fake clock. Shutdown waits for the current sync. |
        | routes | 404, 503 and the export headers. |

    *   **E2E smoke test (Playwright):**
        *   **Setup:** the CI job runs the built image with these options:
            *   `ALLOW_INSECURE_TEST_REPO_URL=1`
            *   `DECK_REPO_URL=file:///fixtures/deck-repo`
            *   `MTGJSON_BASE_URL=http://host.docker.internal:<port>`, with the mini fixture served by a static server on the runner
            *   `--add-host=host.docker.internal:host-gateway`
            *   the fixture repo mounted at `/fixtures/deck-repo`
            *   `WEBHOOK_SECRET` set
        *   **Checks:**
            *   `/readyz` becomes 200.
            *   The gauntlet list shows the fixture gauntlets.
            *   A deck page shows grouped cards and a primer.
            *   A commit made in the mounted fixture repo appears within 45 s with the default 30 s poll interval.
            *   After a signed webhook POST, a new commit appears within 10 s.
            *   The MTGO export matches its fixture.
            *   The proxies page produces a PDF with the expected page count.

#### 74. `packages/app/Dockerfile` (Create)

*   **Type / Scope**: Container image.
*   **Proposed Changes**:
    *   **Build stage:** `node:22-bookworm-slim` with `python3 make g++`. Runs `pnpm install --frozen-lockfile`, `pnpm -r build`, then `pnpm --filter @tcg-gauntlet/app deploy --prod /out`.
    *   **Runtime stage:** `node:22-bookworm-slim` with `git` and `ca-certificates`.
        *   **Files:** copies `/out` to `/app`, and `presets/` to `/app/presets`. Runs `mkdir -p /data && chown node:node /data`.
        *   **Settings:** `ENV PRESETS_DIR=/app/presets`, `USER node`, `VOLUME /data`, `EXPOSE 3000`.
        *   **Healthcheck:** `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`.
        *   **Start:** the entrypoint is `node /app/build/index.js`.

*   **As built (Phase 7a, server side; items 63–71 and the unit and integration part of 73):** items 72 (components, `pdf.ts`), the Playwright part of 73 and 74 (Dockerfile) are Phase 7b.
    *   **SvelteKit 3 differences (kit 3.2.0, adapter-node 6.0.2, vite 8):**
        *   There is no `svelte.config.js`. Kit 3 refuses to start when it exists. The configuration (adapter, `csp` with `mode: 'auto'` and the Security directives) is the argument of `sveltekit()` in `vite.config.ts`.
        *   `tsconfig.json` extends `$app/tsconfig`, not `.svelte-kit/tsconfig.json`.
        *   `$lib` is gone. The app uses the subpath import `#lib/*` (`"imports": {"#lib/*": "./src/lib/*.ts"}` in `package.json`), written without a file extension. Server-only code stays under `src/lib/server`.
        *   `building` comes from `$app/env`, and the hook types (`Handle`, `ServerInit`) from `@sveltejs/kit/hooks`.
        *   Kit's CSRF check answers 403 to a POST with a form content type. The webhook must be configured with content type `application/json` (GitHub's recommended setting).
    *   **Scripts:** `build` is `vite build` (it does not start the sync loop: `init` returns when `building`). `typecheck` is `svelte-kit sync && svelte-check`, which the root `typecheck` runs through `pnpm -r --if-present typecheck`. `e2e` is a placeholder that exits 0. The app has its own `vitest.config.ts`, without the Kit plugin, because the server modules are plain TypeScript. The root ESLint config turns off `svelte/no-navigation-without-resolve` and `prefer-const` for `.svelte` files (no `base` path, and `$props()` destructuring), and a few unsafe-`any` rules for the app's tests.
    *   **SQLite order:** `history-db.ts` imports `@tcg-gauntlet/carddata` first, which sets `SQLITE_USE_URI=1` before better-sqlite3 opens any file. The workspace packages are `ssr.external` in the Vite config, so they are loaded as normal modules at run time (`pnpm deploy` puts them in `node_modules`).
    *   **Config:** `parseConfig(env)` returns a frozen object and throws `ConfigError` with one message per invalid variable. `TCG_GAUNTLET_MIN_CARDS` (test only) lowers the self-check minimum. In test mode a `file://` or `http://` URL is cloned as given, and links to GitHub use it as their base. Otherwise the normalised URL is cloned. `ADDRESS_HEADER`, `XFF_DEPTH`, `ORIGIN` and `HOST` are adapter-node's and are not read by the app.
    *   **History:** `History` (in `history.ts`) owns the database handle, the `cat-file` process and the 500-entry cache. `update(newHead)` returns `full`, `incremental` or `none`. It uses `isAncestor`, which answers false for a missing object, so a force-push and a missing `last_commit` take the same path. A damaged or other-schema file is deleted and rebuilt. `versions()` returns one entry per `seq` with the `.txt` and `.md` blobs in effect at that version. "Date updated" is the newest `author_ts`. A version "does not parse" when `parseDeck` reports any parse error, and is then shown as raw text.
    *   **Snapshot:** it also holds the exports (MTGO, `.dec`, MTGA text and the cards not on Arena), the proxy card list, the MTGJSON version and the lookup, so no route needs card data on the hot path. Only old versions (history pages) are resolved at request time, through `snapshot.lookup`. `buildSnapshot` is async because `resolveFormat` is. A gauntlet whose YAML or format is invalid is listed with its errors and no decks (all its decks count as invalid).
    *   **Sync:** `SyncLoop` takes its collaborators (`git`, the card data layer, `scan`, the clock), so tests use real git on `file://` repos, the mini fixture served over `node:http`, and a fake clock. A poll runs `lsRemote` and stops when the SHA equals the snapshot's. A failed `lsRemote` (throttled or not) counts as a failed sync. A failure schedules the next try after `30 s × 2ⁿ⁻¹`, capped at 10 minutes, in place of the poll. A webhook runs at once. The refresh timer runs under the same lock. Card data failures set `card_data.error` and do not count as sync failures, because the cached copy keeps working. The old lookup is closed 60 s after a swap.
    *   **Routes:** `/readyz` is 200 when a snapshot exists and the card data is open. Every other route except `healthz`, `readyz` and `status` answers 503 ("Preparing data") through `requireSnapshot()`, the webhook included. The `mtga` page route wins over `export/[kind]`. The image route checks the allow-list and face rules first and the rate limit (120 per minute per `getClientAddress()`) afterwards, and answers 502 when the upstream fails. Pages are plain semantic HTML with no styling. Markdown HTML is inserted with `{@html}` only after markdown-it with `html: false`.
    *   **Tests:** 71 tests in 7 files in `packages/app/test` (config 12, webhook, markdown and links, image cache and rate limit, history 5, sync 15, routes 13). Branch coverage of `packages/app/src/lib/server` is 85.5%.
    *   **Run by hand** against a `file://` copy of `template/` with the real MTGJSON data: `/readyz` was 200 after 2 s, and a new commit appeared on the site 11 s after it was made (poll interval 10 s).
    *   **Seams for 7b:** `routes/g/[gauntlet]/[deck]/proxies/+page.svelte` has a TODO and receives `cards` (`{name, count, scryfallId, hasBackFace}`) for `buildProxyPdf`, whose images come from `/img/<id>/<face>`. The pages have TODO markers for `CardGroup`, `CardPreview`, `LegalityBadge`, `ExportMenu`, `DiffTable`, `StaleBanner` and `Footer`. The data they need is already in each page's `data`. The layout renders the stale banner and footer inline. `playwright.config.ts`, `e2e/`, the fixture repo and the Dockerfile are not created. `pnpm -r build` leaves a runnable `packages/app/build`, started with `node build/index.js`.

*   **As built (Phase 7b, components, PDF, Dockerfile, e2e, CI; item 72, the Playwright part of 73, item 74 and the Phase 7 step of item 11):**
    *   **Components:** `CardGroup`, `CardPreview`, `LegalityBadge`, `DiffTable`, `ExportMenu`, `StaleBanner` and `Footer`, plus a small `Breadcrumb`, are in `src/lib/components`. Colours and base styles are tokens in `src/lib/theme.css` (light, and dark through `prefers-color-scheme`), and each component has its own plain CSS. There is no framework, font or external script. `CardPreview` is plain text without JavaScript. After hydration it is a button that shows the `normal` image on mouse hover, on keyboard focus (`:focus-visible`) and on tap, closes on Escape or an outside tap, and is a bottom sheet on phones. The image is lazy and inside a hidden box, so it loads on first use. The inline `small` thumbnails of 7a are gone. `ExportMenu` is a `<details>`. The history page's two-version picker needs JavaScript, so every row also links to "Changes since <previous version>". The pages' view types moved to `src/lib/view-types.ts`, which the components may import (server modules may not be imported by client code).
    *   **`#lib` for components:** `package.json` `imports` has a second entry, `#lib/components/*.svelte`, because `#lib/*` maps to `.ts` files.
    *   **`pdf.ts`:** pdf-lib stays at 1.17.1, the latest release (published 2022-05, so unmaintained, as R12 says). `@cantoo/pdf-lib` 2.11.1 (updated 2026-09) is the fallback, and it needs only the import in `pdf.ts` to change. The layout math and the queue are exported pure functions. Fronts come first, then a double-faced card's backs. Failed fetches (network, 429, 5xx) are retried twice, and any other failure ends the build with a message that names the image. Cut marks are 3 mm long, at both ends of each of the 8 card edges and only inside the margin, so they never touch a card (a line across the margin only, not across the grid). A Letter page has 7.7 mm at the bottom, so the note sits on the middle line of that margin. The proxies page leaves out cards without a `scryfallId`. A deck of 75 cards makes 9 pages.
    *   **Test-only image host:** `TCG_GAUNTLET_IMAGE_UPSTREAM` replaces `https://cards.scryfall.io` for the image route. The config refuses it unless `ALLOW_INSECURE_TEST_REPO_URL` is set. The e2e suite uses it so that the PDF test needs no network. The Scryfall URLs on the pages (`img-src`) are unchanged.
    *   **Dockerfile:** as item 74, plus `tsconfig.base.json` in the build context (every package's tsconfig extends it), `ENV DATA_DIR=/data PORT=3000 NODE_ENV=production`, a 20 s start period for the healthcheck, and `ENTRYPOINT ["node", "/app/build/index.js"]`. `pnpm deploy --prod` puts `build/` (from `files`) and the production modules in `/out`. better-sqlite3 13 ships its Linux binaries in the package, and falls back to compiling in the build stage. The same `tsconfig.base.json` fix was missing in `packages/validator/Dockerfile` and is added there. `docker build` could not be tried in Phase 7 (Docker socket permission denied); Phase 8 built and tested both images. In Phase 7, `pnpm --filter @tcg-gauntlet/app deploy --prod` was run into a scratch folder and the e2e suite passed against `node build/index.js` there.
    *   **E2E:** `playwright.config.ts`, `e2e/smoke.spec.ts`, `e2e/fixture-repo/` (two gauntlets, the `legal-burn` and `legal-jund` conformance decks and a primer), `e2e/expected/burn.mtgo.txt` (byte-exact, marked `-text`), `e2e/stub-card.jpg`. `e2e/fixtures.ts` makes a git repo from the fixture folder and serves the mini MTGJSON fixture (gzip, `.sha256`, `Meta.json`) and the image stub. It can run alone (CI) or be used by `e2e/run.ts`, which also starts `node build/index.js` (or `E2E_APP_DIR`) with `ALLOW_INSECURE_TEST_REPO_URL`, a `file://` repo, `TCG_GAUNTLET_MIN_CARDS=100` and `WEBHOOK_SECRET`. With `E2E_BASE_URL` it only runs Playwright against an app that is already up (`E2E_REPO_DIR`, `E2E_WEBHOOK_SECRET`). `--no-browser` skips the tests tagged `@browser`. `E2E_CHROMIUM_PATH` selects another Chromium. The poll interval is the default 30 s. The e2e scripts run with Node's type stripping (22.18 or newer).
    *   **CI:** a new `app-image` job builds the image, starts the fixtures on the runner (ports 8801 and 8802, on 0.0.0.0), runs the container as the runner's user (so git accepts the mounted repo) with `--add-host=host.docker.internal:host-gateway`, waits for `/healthz`, runs `pnpm --filter @tcg-gauntlet/app e2e` with `E2E_BASE_URL`, and writes the container's memory to the job summary (after the suite, not the peak). The root `typecheck` already ran the app's `svelte-check`.
    *   **Tests:** the app has 92 tests in 9 files (pdf 18, format 2, config 13, and the 7a tests). The e2e suite has 10 tests (8 HTTP, 2 browser).
    *   **Left for Phase 8:** the README and deployment docs, the template's CI, a check of the layout with a real PDF printout, and running the `app-image` job for the first time on GitHub (not possible here).

### Phase 8 — Template, deployment and docs

#### 75. `template/README.md`, `template/CONTRIBUTING.md` (Create)

*   **Type / Scope**: Deck-repo template docs. They are bundled into the validator for `init` (D1).
*   **Proposed Changes**:
    *   **README:** creating a deck repo with `docker run --rm -v "$PWD:/w" -w /w ghcr.io/flippyboy/tcg-gauntlet-validator:v1 init`.
    *   **CONTRIBUTING:**
        *   the editing workflow
        *   the deck file format, linking to the spec
        *   how to run the validator locally
        *   step-by-step instructions for requiring the `validate` status check and pull requests on `main`

#### 76. `template/.github/workflows/validate.yml` (Create)

*   **Type / Scope**: Deck-repo CI.
*   **Proposed Changes**:
    *   **Triggers:** `on: pull_request` and `push` to `main`.
    *   **Permissions:** `contents: read`. No secrets are used.
    *   **Steps:** `actions/checkout` with `fetch-depth: 0`, then `uses: flippyboy/tcg-gauntlet/actions/validate@v<major>`. The release writes the current major version (item 12).
    *   **Job name:** `validate`.

#### 77. `template/modern-2015-example/gauntlet.yaml`, `gauntlet.md`, `burn.txt`, `burn.md`, `template/formats/README.md` (Create)

*   **Type / Scope**: Example content.
*   **Proposed Changes**:
    *   **Example gauntlet:** one gauntlet using `preset:2015-modern@1`.
        *   `burn.txt` is a copy of the conformance case `modern-2015-burn`, which must be legal.
        *   CI validates the template with `--all` (item 11).
    *   **`formats/README.md`:** shows a commented custom format example.

#### 78. `deploy/compose.yaml` (Create)

*   **Type / Scope**: Docker Compose example.
*   **Proposed Changes**: One `app` service.
    *   **Image:** `ghcr.io/flippyboy/tcg-gauntlet:v1`.
    *   **Environment:** `DECK_REPO_URL`, `DECK_REPO_BRANCH`, `WEBHOOK_SECRET` and `PUBLIC_BASE_URL`, plus commented `ADDRESS_HEADER`, `XFF_DEPTH` and `ORIGIN` for use behind a proxy.
    *   **Volume:** a named volume at `/data`.
    *   **Ports:** `3000:3000`.
    *   **Restart:** `restart: unless-stopped`.

#### 79. `deploy/kubernetes/{deployment,service,pvc,secret.example,kustomization}.yaml` (Create)

*   **Type / Scope**: Kubernetes example.
*   **Proposed Changes**:
    *   **Deployment:**
        *   `replicas: 1`, `strategy: Recreate`, `terminationGracePeriodSeconds: 45`.
        *   Pod `securityContext`: `runAsUser: 1000`, `runAsGroup: 1000`, `fsGroup: 1000`.
        *   Container: `readOnlyRootFilesystem: true`, with an `emptyDir` at `/tmp`.
        *   Liveness probe on `/healthz`, readiness probe on `/readyz`.
        *   Resources: request 256Mi, limit 768Mi.
    *   **Storage:** a 5Gi ReadWriteOnce PVC mounted at `/data`.
    *   **Service:** ClusterIP on port 3000.
    *   **Secret:** `tcg-gauntlet` with key `webhook-secret`.
    *   **Kustomization:** sets the image `ghcr.io/flippyboy/tcg-gauntlet:v1` and the namespace `tcg-gauntlet`.

#### 80. `docs/hosting.md` (Create)

*   **Type / Scope**: Host guide.
*   **Proposed Changes**:
    *   **Setup:** every environment variable, volume sizing, and the cold-start time from spike 1.
    *   **GitHub webhook:** payload URL `/webhook/github`, content type JSON, a secret, and the push event only.
    *   **Behind a reverse proxy:** set `ADDRESS_HEADER` (for example `X-Forwarded-For`) and `XFF_DEPTH` so the rate limit sees real client addresses. Set `ORIGIN`, or `PROTOCOL_HEADER` and `HOST_HEADER`, when the proxy terminates TLS.
    *   **Operations:** reading `/status`, and upgrading or rolling back by image tag.

#### 81. `docs/deck-repo-guide.md`, `docs/format-authoring.md`, `docs/architecture.md` (Create)

*   **Type / Scope**: User and contributor docs.
*   **Proposed Changes**:
    *   **`deck-repo-guide.md`:** for deck-repo maintainers.
        *   `init`, the layout, the files and CI.
        *   Branch protection and keeping `main` clean.
        *   The 60-day limit on scheduled workflows.
    *   **`format-authoring.md`:** how to write `formats/*.yaml`, how format keys work, and why set lists are used instead of dates.
    *   **`architecture.md`:** a condensed version of this design's Technical Plan, for contributors.

#### 82. `docs/designs/tcg-gauntlet.md` (Modify)

*   **Type / Scope**: This design document.
*   **Proposed Changes**: Kept in step with decisions made during implementation, such as spike outcomes and the license.
*   **As built (Phase 8, items 75–82):**
    *   **Files:** `deploy/compose.yaml`, the Helm chart `deploy/helm/tcg-gauntlet/` (it replaced the plain manifests of item 79, see below), `docs/hosting.md`, `docs/deck-repo-guide.md`, `docs/format-authoring.md` and `docs/architecture.md`. The template (items 75–77) already matched. Its README gained one note: add `--user "$(id -u):$(id -g)"` when your uid is not 1000. The root README links the docs and `deploy/`.
    *   **Kubernetes (Helm chart, replaces item 79's manifests at the author's request):** the chart renders a Deployment, Service, PVC, ServiceAccount and, when asked, a Secret and an Ingress. Its defaults match item 79. `deckRepo.url` is required (in the template and in `values.schema.json`, so `helm lint --strict` fails without it). There is no replica count: one replica, `Recreate`. The release packages it with `--version` and `--app-version` set to the tag without its `v`, and pushes it to `oci://ghcr.io/flippyboy/charts/tcg-gauntlet`. The image tag defaults to `v` plus the app version, which is the tag the release pushes. CI runs `helm lint --strict`, a negative lint without the URL, and kubeconform on three renders. Settings as item 79, plus `runAsNonRoot`, a `RuntimeDefault` seccomp profile, `allowPrivilegeEscalation: false` and `capabilities: drop: [ALL]`. `WEBHOOK_SECRET` comes from the Secret with `optional: true`, so the pod starts without it and the webhook stays off (404). The kustomization's `namespace` does not create the namespace, so `docs/hosting.md` says to run `kubectl create namespace tcg-gauntlet` first. The app writes only to `/data` (git's `HOME` is `/data/home`, downloads go to `/data/tmp`) and `/tmp` (SQLite's temporary files).
    *   **Release fix (item 12):** the validator image copies `template/` at build time for `init`, but `release.yml` replaced `__ACTION_REF__` only after the images were pushed. A released `init` would have written `uses: __ACTION_REF__`. A step before the builds now replaces `__ACTION_REF__` (it needs only the tag) and fails if any placeholder is left in `template/`. The last step still pins `__VALIDATOR_IMAGE__` to the digest and commits both files.
    *   **Documented as the code does it, where the design said less:** `/status` mixes camelCase (`engineVersion`, `lastSync.*`) and snake_case (`consecutive_failures`, `card_data.*` and others). The poll wait is varied by about 10 % and backs off after failures (30 s, 60 s, 120 s, up to 10 min). Webhook answers are 404 without a secret, 401 for a bad signature, 202 for pings, other events, other branches and non-JSON bodies, 429 within 5 s of the last trigger, 503 before the first snapshot, and 413 above adapter-node's `BODY_SIZE_LIMIT` (512K default). `--changed-since` also re-checks a deck when its `.md` changes. `DECK_REPO_URL` allows no credentials, so only public repos work, as in v1's scope.
    *   **Verified here (Docker through sudo):**
        *   **Builds:** both images build, the app in 24 s and the validator in 52 s on a warm layer cache. The image sizes are 645 MB (app) and 510 MB (validator) unpacked, or 156 MB and 128 MB compressed. Both run as `node` (uid 1000, gid 1000).
        *   **E2E:** the `app-image` job's steps passed against the app image, 10 of 10 tests. One local difference: the container used `--network host`, because this machine's firewall blocks the container from reaching `host.docker.internal`. The container used 83 MiB after the suite.
        *   **Kubernetes settings:** the app ran with them (read-only root, a tmpfs at `/tmp`, all capabilities dropped, `no-new-privileges`). It was ready in 2 s and served pages.
        *   **Validator:** `init` into an empty folder, then `--all` against the real MTGJSON. The first run took 9 s with an empty cache (700 MB cached afterwards) and the second 2 s, with 0 errors on the template. Adding `4 Black Lotus` gave `E-LEGAL-NOT-IN-POOL` at the right line and exit 1.
        *   **Deploy files:** `docker compose config` renders. The Helm chart passes `helm lint --strict`, and kubeconform accepts its renders.
    *   **Not verified:** the workflows on GitHub, a live GitHub webhook, a real cluster, a printed proxy PDF, and imports into MTGO, Cockatrice and Arena.

### Verification Plan

*   **Compilation/Build**:
    *   `pnpm install --frozen-lockfile && pnpm build`
    *   `docker build -f packages/app/Dockerfile .`
    *   `docker build -f packages/validator/Dockerfile .`
*   **Unit Tests**: `pnpm test` runs vitest for every package, including the conformance corpus through both the fake lookup and the SQLite lookup.
*   **Static Analysis & Linting**:
    *   `pnpm lint`, using ESLint with type-checked rules and the engine's no-I/O import rule.
    *   `pnpm format`.
    *   `pnpm typecheck`, which runs `tsc -b` and `svelte-check`.
    *   The generated schema validators are regenerated, and any diff fails the check.
*   **Test Coverage Requirement**:
    *   85%+ branch coverage for `engine` and `carddata`.
    *   70%+ for `repo`, `validator`, `conformance` and `app/src/lib/server`.
*   **E2E/Integration**:
    *   `pnpm --filter @tcg-gauntlet/app e2e`, run against the built image (item 73).
    *   The validator CLI integration tests (item 62).
*   **Acceptance checks**: these map to goals G5, G6 and G10.
    *   With the default 30 s poll interval, a fixture commit is visible within 45 s by polling, and within 10 s after a webhook (item 73).
    *   The `ci-timing` job shows a warm-cache validator run under 60 s, and records the cold-cache time (item 11).
    *   A cold start with an empty volume becomes ready with no manual steps (item 73).
