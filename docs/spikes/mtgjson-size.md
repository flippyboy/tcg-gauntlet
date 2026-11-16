# Spike 1: MTGJSON size and archives

Run on 2026-11-15 against MTGJSON `5.3.0+20261115`. Scripts: `spikes/mtgjson-size/measure.ts`, `spikes/mtgjson-size/preset.ts`, `spikes/mtgjson-size/run-timed.py`. Large files are in `spikes/mtgjson-size/out/` (git-ignored).

## Result

**GO.** Both thresholds pass with a wide margin, so the card-data fallback (a repo-published slim file) is not needed.

| Threshold | Limit | Measured | Verdict |
|---|---|---|---|
| Unpacked `AllPrintings.sqlite` | 1.5 GB | 722,534,400 bytes (689.1 MiB, 0.72 GB) | Pass, 48% of the limit. |
| Cold CI run (download, unpack, checksum, self-check, derived build) | 5 min | About 12 s on this machine; estimate below | Pass, by a factor of 10 or more. |

Caveats: this is a developer machine (4 cores, 32 GB RAM, home internet), not a GitHub runner, and the OS file cache was warm for the build step (the file had just been written). The estimate for a runner is in "Measurements". `better-sqlite3` was not tested.

MTGJSON does **not** keep older versions (see below). The design already plans for that.

## Method

All HTTP requests used `User-Agent: tcg-gauntlet-spike/0.1`.

```
curl -s https://mtgjson.com/api/v5/Meta.json
curl -sI https://mtgjson.com/api/v5/AllPrintings.sqlite{,.gz,.xz,.bz2,.zip,.sha256,.gz.sha256}
curl -s -w 'dl_time=%{time_total}s speed=%{speed_download}' -o AllPrintings.sqlite.gz https://mtgjson.com/api/v5/AllPrintings.sqlite.gz
python3 -I spikes/mtgjson-size/run-timed.py -- sh -c 'gunzip -c AllPrintings.sqlite.gz > AllPrintings.sqlite'
sha256sum AllPrintings.sqlite.gz AllPrintings.sqlite
curl -s https://mtgjson.com/api/v5/ | grep -oE 'href="[^"]+"'      # directory listing
sqlite3 AllPrintings.sqlite ".schema cards" ".schema sets" ...
node spikes/mtgjson-size/measure.ts                                 # derived build, Node v26.5.0, node:sqlite (SQLite 3.53.3)
python3 -I spikes/mtgjson-size/run-timed.py -- node spikes/mtgjson-size/measure.ts   # whole-process RSS
```

`/usr/bin/time` is not installed here, so `run-timed.py` reports `ru_maxrss` of the child process.

## Measurements

### Meta.json

Exact shape (the same two fields appear twice, under `meta` and under `data`):

```json
{"meta":{"date":"2026-11-15","version":"5.3.0+20261115"},"data":{"date":"2026-11-15","version":"5.3.0+20261115"}}
```

So `data.version` and `data.date` exist as the design expects. The version is `<semver>+<yyyymmdd>`. The `+` needs escaping if the version is used in a path. The design's `derived/<version>-<date>.sqlite` would give `5.3.0+20261115-2026-11-15`. The date is redundant since it is inside the version. Response headers: `cache-control: max-age=57600` (16 h) on Cloudflare, and the sampled response had `age: 20068`. A refresh check can therefore see a version up to 16 h stale. Harmless for a 24 h refresh cycle, but the "version and date unchanged, so stop" step must not be tested against a just-published release.

### Files and sizes

| File | Bytes | Note |
|---|---|---|
| `AllPrintings.sqlite.gz` | 227,432,018 (216.9 MiB) | Header `content-length`, equal to the downloaded size. |
| `AllPrintings.sqlite.xz` | 125,302,748 (119.5 MiB) | HEAD only. |
| `AllPrintings.sqlite.bz2` | 164,290,612 (156.7 MiB) | HEAD only. |
| `AllPrintings.sqlite.zip` | 227,432,116 | HEAD only. |
| `AllPrintings.sqlite` (unpacked) | 722,534,400 (689.1 MiB) | Also published uncompressed (HEAD has no `content-length` for it, as it is served compressed). Page size 4096, 176,400 pages, `journal_mode=delete`, `integrity_check` ok. |
| `derived.sqlite` (see below) | 12,455,936 (11.9 MiB) | Preset plus `official:modern`, with the FTS table. |

### Timings (this machine)

| Step | Time | Peak RSS |
|---|---|---|
| Download `.gz` (curl, 227,432,018 B) | 3.94 s (57.7 MB/s) | n/a |
| `gunzip -c` to file | 2.94 s wall (2.46 s user) | 12.0 MiB |
| `sha256sum` of `.gz` | 0.40 s | n/a |
| `sha256sum` of unpacked file | 1.26 s | n/a |
| Derived build (all tables, below) | 1.24 to 1.34 s, 3 runs | 126 to 128 MiB for the whole Node process |

Estimate for a GitHub runner (4 vCPU, not measured): download 5 to 20 s (the file is on Cloudflare; the runner's network is typically 100 MB/s or more, but variable), gunzip 3 to 6 s, SHA-256 of both files 2 to 3 s, build 2 to 4 s on a slower core and a cold page cache (the first read of 722 MB from disk adds a few seconds). Total roughly 15 to 40 s, against a 300 s limit. For a 2-vCPU host the same steps are single-threaded, so the numbers scale with clock speed, not core count. Not measured on either.

### Checksums

- `AllPrintings.sqlite.gz.sha256` and `AllPrintings.sqlite.sha256` are both published. Each is 64 bytes: bare hex, no file name, no trailing text.
- `.sha256` also exists next to every other variant (`.xz`, `.bz2`, `.zip`) and next to `Meta.json`. There are no `.md5` or `.sha512` files (404).
- Both match: `.gz` = `e7afb693...787a4`, unpacked = `c0306c5d...7766d`. The `.gz` checksum covers the compressed file, so a corrupt gunzip result is caught by the other one.
- The checksum files are on the same server as the data, so they detect corruption, not tampering.

### Older versions

`https://mtgjson.com/api/v5/` is an Apache-style "Index of /api/v5/" page with 9,176 links. It lists only the current files: `AllPrintings.{json,sql,sqlite,psql}` (each with `.bz2 .gz .xz .zip` and `.sha256`), `AllSetFiles`, `AllDeckFiles`, `AllPrintingsCSVFiles`, `AllPrintingsParquetFiles`, `AllPrices*`, `AllIdentifiers`, `Meta.json`, one file per set (`10E.json` ...), and the directories `csv/`, `decks/`, `parquet/`. Last-modified is 2026-11-15 for everything I looked at. There is no archive directory and no version-stamped file names. `/api/v5/archive/`, `/api/v5/old/` and `/api/v4/` return 404, and `AllPrintings.5.3.0+20261114.sqlite.gz` returns 404. (`AllPrintings.sqlite?v=5.3.0` returns 200, but that is the current file with an ignored query string.) The Wayback Machine and the MTGJSON GitHub releases were not checked.

Conclusion: old versions are not kept, so repeatable verdicts rest on the format definitions only. The design already says so.

### Real schema (relevant parts)

Tables present: `cards`, `sets`, `cardLegalities`, `cardIdentifiers`, `meta`, `tokens`, `cardForeignData`, `cardPurchaseUrls`, `cardRulings`, `setTranslations`, `sealedProducts`, and `setBooster*`, `setDecks`, `token*`. There is **no** table named `legalities` or `identifiers`. The design's assumed names (`cards`, `sets`, `cardLegalities`, `cardIdentifiers`) are correct. Row counts: `cards` 115,997; `sets` 883; `meta` 1 (`date`, `version`, same values as `Meta.json`).

`cards` (all columns are TEXT unless noted):

| Design field | Real column | Type and facts |
|---|---|---|
| name | `name` | Full name. For every multi-face card it is `A // B` on every face row. |
| faceName | `faceName` | NULL for single-face cards. |
| side | `side` | NULL (111,018), `a` (2,497), `b` (2,473), `c`, `d`, `e` (few). **Each face is its own row**, so 115,997 rows are not printings. Front-face-or-single rows (`side IS NULL OR side='a'`): 113,515. |
| layout | `layout` | `normal`, `transform`, `split`, `adventure`, `modal_dfc`, `flip`, `meld`, ... (also `prepare`, `reversible_card`, `host`, `augment` etc.). |
| setCode | `setCode` | Matches `sets.code`. |
| number | `number` | TEXT, can be `128`, `128a`, `S5a`, `★`. Use `CAST(number AS INTEGER)` for the numeric part. |
| uuid | `uuid` | Unique per row (115,997 distinct), so each face has a different uuid. Indexed. |
| availability | `availability` | **Comma-plus-space separated string**, e.g. `mtgo, paper`, `arena, mtgo, paper`, `paper`, `arena`, `shandalar`, `dreamcast`; one empty row. `LIKE '%paper%'` is safe: no other value contains that substring. |
| isFunny, isOnlineOnly, isOversized, isPromo | same | `BOOLEAN`, stored as integer `1` or **NULL**. False is NULL, not 0 (`typeof` shows only `integer` or `null`). `isFunny = 0` matches nothing. Use `COALESCE(col,0)=0`. |
| originalReleaseDate | same | TEXT `YYYY-MM-DD`, NULL for 100,686 rows, set for 15,311. |
| supertypes | `supertypes` | TEXT, comma-separated (`Basic, Snow`), **empty string** (not NULL) when none. |
| types | `types` | TEXT, comma-separated (`Creature`). |
| text | `text` | TEXT, per-face. |
| manaValue | `manaValue` | REAL. |
| Also useful | `language` | 20 values; English 113,359 rows, Spanish 1,212, Japanese 630, French 430 ... (not in the design). `hasAlternativeDeckLimit` (100 rows, 13 names). `asciiName` (292 rows; accent-free name). `isTimeshifted` (374 rows). `isReprint`. `otherFaceIds`. |

`sets`: `code`, `name`, `type`, `releaseDate` (TEXT `YYYY-MM-DD`), `parentCode`, `block`, `isOnlineOnly`, `isPaperOnly`, ... 883 rows. Types and counts: `promo` 301, `expansion` 121, `memorabilia` 104, `box` 50, `commander` 47, `masters` 33, `duel_deck` 28, `core` 26, `token` 25, `funny` 22, and others. Set `type` for TSB is `expansion` (see spike 2).

`cardLegalities`: **one row per card uuid, one column per format** (`uuid`, `alchemy`, `brawl`, `commander`, `competitivebrawl`, `duel`, `future`, `gladiator`, `historic`, `legacy`, `modern`, `oathbreaker`, `oldschool`, `pauper`, `paupercommander`, `penny`, `pioneer`, `predh`, `premodern`, `standard`, `standardbrawl`, `timeless`, `tlr`, `vintage`). Values: `Legal`, `Banned`, `Restricted`, and NULL for not legal. Modern: 83,480 `Legal`, 459 `Banned`, 32,058 NULL. Vintage: 108,728 `Legal`, 664 `Restricted`, 223 `Banned`, 6,382 NULL. So `official:<name>` needs a column name from a fixed allow-list (a column cannot be a bound parameter), checked against `pragma_table_info('cardLegalities')`.

`cardIdentifiers`: `uuid` plus `scryfallId` (a lower-case UUID string like `fce1a3a3-...`), `scryfallOracleId`, `scryfallIllustrationId`, `multiverseId`, `mtgoId`, `mtgArenaId`, and others. Indexed on `uuid`.

Counts: **115,997 rows in `cards`**; 113,515 front-face or single-face rows (this is the closest figure to "printings"); **35,495 distinct names**; 768 distinct set codes in `cards`; `cards.number` is non-null everywhere; every `cards.setCode` exists in `sets`.

Indexes shipped by MTGJSON: `cards(uuid)`, `cards(name)`, `cards(setCode)`, `sets(code)`, `sets(name)`, `cardLegalities(uuid)`, `cardIdentifiers(uuid)`.

### Derived build prototype

URI attach works in both the `sqlite3` 3.54.0 CLI and Node's built-in `node:sqlite` (SQLite 3.53.3):

```
sqlite3 derived.sqlite "attach 'file:/abs/path/AllPrintings.sqlite?mode=ro' as mtg; select count(*) from mtg.cards;"   -> 115997
sqlite3 derived.sqlite "attach 'file:...?mode=ro' as mtg; insert into mtg.sets(code) values('ZZZ');"                   -> Error: attempt to write a readonly database
```

The `main` database stays writable; writes to `mtg.*` are refused. `ANALYZE` without a schema name touches `mtg` and fails, so use `ANALYZE main`. `PRAGMA ... mtg.pragma_table_info('cards')` works for the self-check. FTS5 is compiled into `node:sqlite`. `better-sqlite3` was not installed or tested.

Stage timings from `node spikes/mtgjson-size/measure.ts` (three runs; the values below are run 2; stage times vary by about 10%):

| Stage | Time | Output |
|---|---|---|
| open + `ATTACH ... mode=ro` | 0.04 s | |
| self-check (`pragma_table_info` for 5 tables, `count(*)`) | 0.003 s | |
| (a) `format_pool` for 2015 Modern (49 sets, minus 32 banned) | 0.021 s | 9,186 names |
| (b1) `default_printing` for 2015 Modern (`ROW_NUMBER()` window) | 0.084 s | 9,186 rows |
| (b2) `default_printing` for `official:modern#mtgjson` | 0.349 s | 32,981 rows |
| (c1) `card_names` (JS NFKD normalisation) | 0.297 s | 38,360 rows |
| (c2) `card_names_fts` (FTS5, `tokenize='trigram'`) | 0.275 s | trigram query `ightnin` returns Arc Lightning, Ball Lightning, Barbed Lightning, ... in 0.2 ms |
| (d) `card_meta` including `copy_exempt` | 0.257 s | 35,495 rows, 32 with `copy_exempt=1` |
| `ANALYZE main` + checkpoint | 0.009 s | |
| **Total** | **1.24 to 1.34 s** | `derived.sqlite` 12,455,936 B |

Peak RSS 126 to 128 MiB for the whole Node process (about 85 MiB of that is Node itself after opening the database). The default SQLite page cache (about 2 MiB per connection) was used and builds were not slower for it. The `sqlite3` CLI alone reads the 722 MB file with 12 MiB RSS.

`official:modern` has 32,981 default-printing rows against 35,495 names: 2,514 names have no paper, non-online printing (Arena-only or MTGO-only cards), so they get no row.

Observations from the build that change SQL (see next section):

- Ordering `... number, uuid` alone gives two face rows the same sort key. The `uuid` tiebreak then picks one at random, which can be the back face. I restricted the window input to `side IS NULL OR side='a'`; with that, 0 default printings point at a `b` face.
- 85 of the 32,981 `official:modern` default printings are non-English printings (the oldest paper printing of those names is in another language). The 2015 Modern preset has 0, because every pool name has an English printing in the listed sets.
- For `official:modern` the oldest printing wins, so Lightning Bolt shows `LEA#161`, Island `LEA#288`. That is correct under the rule (display only), but it is Alpha art in a Modern format.

### Disk and volume sizing

Steady state with the current and the previous version kept: 2 x (722.5 MB + about 12 MB per derived file) = about 1.47 GB. During a refresh the new `.gz` (227 MB), the unpacked new file (722.5 MB) and its derived file exist while both old versions are still present, so the peak is about 1.47 GB + 0.74 GB + 0.23 GB = **about 2.4 GB**, or about 1.7 GB if the previous version is deleted before the new unpack (not allowed by the "keep previous" rule). If the `.gz` is streamed through gunzip instead of stored, the `.gz` term goes away, and so does the possibility of verifying the `.gz.sha256`; prefer storing it and deleting it after the checks.

**Recommended minimum volume size: 4 GiB for card data** (2.4 GB peak plus about 40% headroom for MTGJSON growth and SQLite temp files), and **5 GiB** if the same volume holds the image cache and the git clones. The unpacked file would have to grow by a factor of about 2 to hit the 1.5 GB limit; the size history is not available (no archive), so revisit if the file reaches 1 GB.

## Implications for the design

Changes to the Technical Plan and to item 43 (`mtgjson-queries.ts`):

1. **Boolean columns are NULL when false.** Every pool and printing predicate must use `COALESCE(c.isFunny,0)=0` (and the same for `isOnlineOnly`, `isOversized`, `isPromo`) or `IS NOT 1`. State this in "Format-definition schema v1" and in "Default printing".
2. **Face rows.** `cards` has one row per face and per printing. Say so in `packages/carddata`. `default_printing` must use only `side IS NULL OR side='a'` (add this to the qualifying list in "Default printing" as rule 5, or add `side` before `uuid` in the order). `card_meta`, `card_names` and `format_pool` group by `name`, which handles faces. The design's "printings" count is 113,515 front-face rows, not 115,997.
3. **Default printing language.** Add "`language` is `English`, unless the card has no English printing" to the qualifying rules, or filter `language='English'`. Without it, 85 `official:modern` defaults are foreign-language printings.
4. **Availability** is a comma-plus-space string: use `availability LIKE '%paper%'`. Add the fact to the design.
5. **`official:<name>` legality** reads `cardLegalities.<name>` with values `Legal`, `Banned`, `Restricted`, NULL. NULL means not legal. Use a fixed allow-list of column names, not string interpolation of user text.
6. **`copy_exempt`.** The prototype ORs three sources and gets 32 names: `supertypes LIKE '%Basic%'` (19 names, including odd ones such as `Barry's Land` and `Forest // Forest`), the text `A deck can have any number of cards named` (11 names), and `hasAlternativeDeckLimit=1` (13 names). `hasAlternativeDeckLimit` also covers Nazgul and Seven Dwarves ("up to N copies"), which are **not** unlimited, so the prototype wrongly exempts those two. Use `supertypes` plus the text match for `any_number_text`, and leave `hasAlternativeDeckLimit` out (or handle "up to N" separately, out of v1 scope). Fix before item 43.
7. **`card_names`.** Add `asciiName` (292 rows) as a normalisation source, because NFKD does not turn `Æ` into `ae`, and `ß`, `Ø` and similar stay unchanged. Check `normalizeName()` (item 31) against `asciiName` in a test: for every row with a non-null `asciiName`, `normalizeName(name)` should equal `normalizeName(asciiName)`, or the alias row is needed.
8. **`Meta.json`** is `{"meta":{...},"data":{...}}`. Read `data.version` and `data.date`, and use `meta.version` as a fallback only if absent. The `meta` table inside the database has the same two values and can be cross-checked in the self-check. The refresh step 1 should tolerate a CDN-stale response.
9. **Checksum step.** Add to refresh step 2: fetch `AllPrintings.sqlite.gz.sha256` and compare to the downloaded `.gz`; also `AllPrintings.sqlite.sha256` against the unpacked file. Each file is 64 hex characters with no file name. If either is missing, the self-check still runs (the file is the same server, so no extra trust).
10. **Table names** are confirmed: `cards`, `sets`, `cardLegalities`, `cardIdentifiers`. Remove "assumptions to confirm in the size spike" from the `packages/carddata` text. Add `meta` to the self-check.
11. **Derived build** time is about 1.3 s for a custom format plus `official:modern`, so building at startup and on every refresh is cheap, and "build lazily per format" is not needed. A build with 5 or 10 formats is still about 2 to 4 s. The derived file is about 12 MB.
12. **Memory.** Peak RSS of the build process is about 128 MiB, so the 2-vCPU host memory budget is not driven by card data. Keep `cache_size` default; no tuning was needed.
13. **Volume.** Put 4 GiB (card data) or 5 GiB (card data plus images and clones) in "Configuration" and "Cold start" as the minimum. The `.gz` should be removed after the checks.
14. **URI attach** works with `file:...?mode=ro` for the CLI and `node:sqlite`. `ANALYZE` must name the main schema. Item 1's "Whether better-sqlite3 accepts `file:` URIs" is still open (see below), but `node:sqlite` is a possible alternative driver (Node 26 ships it, still marked experimental).

## Open issues

- `better-sqlite3` was not installed, so URI attach with it is unverified. It needs to be opened with the `file:` URI enabled; SQLite is compiled with URI support in most builds, but check before choosing it.
- Timings are from a developer machine, not a GitHub runner or a 2-vCPU host. The estimate is a projection. Run `measure.ts` once in the first CI job to replace it.
- The file cache was warm during the derived build. A cold read of 722 MB from a slow volume was not measured.
- MTGJSON size growth over time is unknown (no archive). The Wayback Machine and GitHub releases were not checked for old file sizes.
- Whether `.xz` should be preferred (119.5 MiB against 216.9 MiB) was not measured for unpack time; `xz -d` is typically 3 to 5 times slower than gunzip. At the current size the saving is about 100 MB, about 2 s of download here, so `.gz` is fine.
- `measure.ts` is a prototype using a simplified `normalizeName` and the placeholder key `preset:2015-modern@1#000000000000`.
