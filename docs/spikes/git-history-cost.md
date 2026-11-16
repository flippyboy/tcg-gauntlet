# Spike 4: history cost

## Result

**GO.** The history pass is far inside both thresholds, so history stays in the sync critical path and the fallback (background stage) is not needed.

| Threshold | Limit | Measured (median of 5) |
|---|---|---|
| Full rebuild, 100 decks, 3,000 first-parent commits | 60 s | **0.25 s** (git 48 ms, parse 6 ms, insert 43 ms, rest is DB create/fsync/rename) |
| Incremental update after a 10-file push | 2 s | **0.06 s** |

The rules in the design also work, with six corrections and clarifications listed under "Problems found" (the deck-lifecycle rule for `D`, the filter-boundary rule, `current_path` NULL on delete, per-commit ordering, resolving HEAD to a SHA before running, and a note on `--follow`/duplicate content). None of them changes the verdict.

## Method

All code is under `spikes/git-history/`. Generated data is under `spikes/git-history/out/` (git-ignored by `spikes/git-history/.gitignore`).

* `generate.ts` builds `out/repo` with `git fast-import` (deterministic: seeded PRNG, fixed authors, fixed dates from 2024-01-01). It produces:
  * 10 gauntlet folders (names include a space, `-`, and non-ASCII: `pauper cube`, `Épique`), 100 decks created in the first 100 commits, about 65% with a `.md` primer, deck names with spaces, `&`, `'`, `★`-style and CJK/accented characters (`日本語 deck`, `Niño Combo`, `Élan Vital`, `Death & Taxes`).
  * 3,000 commits on `main` along the first-parent line, plus 955 feature-branch commits, so 3,955 commits in total. 539 of the 3,000 first-parent commits are `--no-ff` style merge commits (about 18%, authored by "Merge Bot"). About half of the merges have an unrelated `main` commit in between, so history is really non-linear.
  * Activity: 1,451 card-count edits, 373 set-code changes, 400 primer edits/adds, 97 renames (53 plain, 20 rename+edit in one commit, 24 rename in one commit and edit in the next, 20 where `.txt` is renamed and the `.md` primer one commit later; 34 renames are of an already-renamed deck), 14 deletes of whole decks, 14 re-adds of a deleted path, 23 commits that touch 10 decks at once.
  * Non-deck files: `README.md`, `formats/modern2015.yaml`, nested `2015modern/archive/old deck.txt` and `2015modern/archive/notes.md`.
  * Final state: 100 live decks, 202 tracked files.
* `history-pass.ts` implements the design's pass exactly as documented, plus the corrections below where the design is silent:
  * `git log --first-parent --reverse -z --no-abbrev --raw -M --format=%x1e%H%x1f%an%x1f%aI%x1f%cI%x1f%s <range> -- '*.txt' '*.md'`.
  * Parser splits on `\x1e`, header on `\x1f`, then NUL-separated raw tokens (`R`/`C` take two paths).
  * Path filter `^<gauntlet>/<deck>.(txt|md)$`, status rules, global `seq`, tables `sync_state`, `decks`, `deck_versions` with the documented keys and the `commit_sha` index, using `node:sqlite`.
  * `fullRebuild` writes `<db>.tmp` and renames; `incremental` returns `null` (caller must full-rebuild) when `last_commit` is missing or not an ancestor; both write rows, `last_commit` and `last_seq` in one transaction.
* `verify.ts` runs the correctness checks. `bench.ts` runs the timings (5 runs each, median reported). Both are re-runnable: `node generate.ts && node verify.ts && node bench.ts` inside `spikes/git-history/`.
* Environment: git 2.56.0, Node v26.5.0, local SSD, default `synchronous` (no unsafe pragmas used in the timings), warm file cache.

## Correctness checks

| # | Check | Result |
|---|---|---|
| a1 | Full rebuild at commit 2,000, then 182 pushes of 1 to 25 first-parent commits each (real history, including renames and merges) up to the final HEAD. After every push the incremental DB was compared row for row (`decks`, `deck_versions`, `sync_state`) with a fresh full rebuild at the same HEAD. | **PASS**, 182/182 identical, no fallback to full rebuild needed |
| a2 | Synthetic pushes on top, each compared with a fresh full rebuild: a single commit editing 10 files; multi-commit push (add, rename with primer, rename again, rename+edit across gauntlets, primer moved in a later commit, edit after rename); delete and re-add in one push; `a->b` plus a new `a` in the same commit; swapping two deck names; moves across the filter boundary (into a nested folder, out to the repo root, to `.bak`, `.txt` to `.md`) and back; a real `git merge --no-ff` of a branch that renames and edits; a commit touching only non-deck files and a nested deck | **PASS**, 8/8 identical |
| a3 | Force-push (history rewritten so `last_commit` is no longer an ancestor) | **PASS**, `incremental` returns `null` and the caller rebuilds |
| b1 | A deck renamed twice or more keeps one `deck_id` and all versions | **PASS**. 23 decks have two or more `.txt` renames. Example: deck 5 has 17 `.txt` versions over 4 distinct paths. |
| b2 | Cross-check against `git log --first-parent --follow` for all 100 live decks | **PASS**, with a caveat. The deck's versions are exactly the newest N commits of `--follow` for all 100. For 13 decks `--follow` continues beyond the creation commit into an unrelated "copy source" (a known `--follow` heuristic that looks for similar files in the whole parent tree). `--follow` is therefore not a usable oracle or fallback for creation. |
| c | Delete then re-add of the same path gets a new `deck_id` | **PASS**, 14 deletes, 14 re-adds, 14 new ids, 0 reused |
| d1 | Merge commits appear as exactly one version per deck and kind under `--first-parent`, and the entries equal `git diff-tree -M <merge>^1 <merge>` | **PASS**. 539 merges on the first-parent line, 469 carry deck rows, 0 duplicate (commit, deck, kind) rows, 0 mismatches against `diff-tree` in 150 sampled merges. |
| d2 | Author and date git reports for a merge | **Informational.** Author and committer are those of the merge commit itself ("Merge Bot", the merge time), not the feature branch author (here "Dee Dvořák", 43 minutes earlier). `git log --raw` on a merge prints 0 raw lines without `--first-parent` and the diff against the first parent with it. |
| e | Names with spaces and Unicode: every stored `(commit_sha, path_at_commit)` resolves through `git cat-file --batch-check` to the stored `blob_sha` | **PASS**, 2,513 rows, 0 mismatches, 748 rows with non-ASCII paths, 2,115 with spaces. `-z` gives raw UTF-8 paths with no quoting. |
| f | The latest version of every live deck and kind equals the blob at HEAD; no nested or non-deck path leaks into the tables; live deck count equals the `.txt` files at HEAD | **PASS**, 200 pairs, 0 wrong, 0 leaked, 100 = 100 |

## Measurements

Each figure is the median of 5 runs on the 3,000-commit repo. Raw numbers are in `spikes/git-history/out/bench-results.txt` (regenerated by `bench.ts`).

| Measurement | Median | Range |
|---|---|---|
| Full rebuild, total wall (rev-parse, git log, parse, insert, close, rename) | 253 ms | 239 to 263 ms |
| of which `git log` (spawn and collect output) | 48 ms | 46 to 50 ms |
| of which parse | 6 ms | 4 to 8 ms |
| of which insert (one transaction, 2,527 rows, default fsync) | 43 ms | 42 to 45 ms |
| `git log` alone to `/dev/null` | 43 ms | 41 to 45 ms |
| Incremental after a 10-file single-commit push, total wall (rev-parse, `merge-base --is-ancestor`, open db, log, parse, insert) | 59 ms | 52 to 71 ms |
| of which `git log` / insert and commit | 2.3 ms / 25 ms | |
| Incremental after a real 10-commit push | 55 ms | 54 to 55 ms |
| 500 blobs through one `git cat-file --batch` process (includes spawn) | 6.5 ms | 5.6 to 8.9 ms |
| 500 blobs through 500 `git cat-file -p` spawns | 897 ms | 732 to 938 ms |
| `.git` size on disk | 6.5 MiB (pack 2.1 MiB, 13,453 objects) | |
| `history.sqlite` | 800 KiB (114 decks, 2,527 version rows, 2,228 seq values) | |
| `git log` output | 714 KiB | |

`--batch` is about 140 times faster than separate calls (about 1.8 ms per spawn), which confirms the design's choice of one long-lived process. Headroom against the thresholds is about 240x for a full rebuild and about 35x for an incremental update, so even a repo ten times bigger stays under both limits. The cost is dominated by the fsync of the SQLite commit and the process spawns, not by git's walk.

Rows by type: 2,527 version rows (A 226, M 2,108, R 179, D 14) over 2,716 commits that had a path-matching entry; 2,228 of those commits had a kept deck entry, so `last_seq` = 2,228. The other 488 touched only `.txt` or `.md` files outside the filter (nested folder, README, etc.).

## Problems found in the design and proposed corrections

### 1. `D` and "same path" are ambiguous: the unit of identity is not defined

The design says `A` on a path with no `decks` row inserts a new `deck_id`, and "a later `A` on the same path starts a new `deck_id`" after a `D`. But `decks.current_path` has one value per deck, a deck has two files (`.txt`, `.md`), and the schema has no way to say "deleted". An implementation has to choose, and a naive one gives different results for incremental and full runs or leaves ghost decks. With the first version of the pass (deck alive while either file exists) 18 decks stayed "live" with only an orphan `.md` after the `.txt` was renamed.

**Proposed replacement for the Status rules bullet and the `decks` row** (this is what `history-pass.ts` does and what the checks above verify):

```text
* `decks.current_path` is the deck path without extension, `<gauntlet>/<deck>`. It is NULL once the deck is deleted
  (the UNIQUE index allows many NULLs). A deck row is created only by a `.txt` event.
* Status rules (applied per commit, `.txt` entries first, then `.md`; within a kind, `D` and `R` before `A` and `M`):
  * `.txt` `A`, or `M`/`R` with no live row: insert a `decks` row and a version with status `A`.
  * `.txt` `M`: add a version.
  * `.txt` `R` (both paths pass the filter): add a version with status `R` and set `current_path` to the new stem.
  * `.txt` `D`: add a version with a NULL blob and set `current_path` to NULL. A later `A` on the same path gets a new `deck_id`.
  * `.md` events attach to the live deck at the stem of the (new) path. An `.md` event with no live deck at that stem is skipped.
  * `.md` `R` where the deck is already at the new stem (the `.txt` moved first, in this or an earlier commit): add a version `R`.
    If the primer moves away from a deck that stays behind, add `D` for the old deck and `A` for a deck at the new stem if one exists.
* Boundary rule: an `R` entry is kept as `R` only when both paths pass the path filter and have the same extension.
  Otherwise it is split: `D` for the old path if it passes the filter, `A` for the new path if it passes the filter.
```

### 2. Renames across the filter boundary and across extensions

Verified with `git log` on a scratch repo (`spikes/git-history/out/probe`):

| Change | With `-- '*.txt' '*.md'` | Without a pathspec |
|---|---|---|
| `g/a.txt` to `g/sub/a.txt` (nested, still `.txt`) | `R100` (new path is outside the deck-path filter) | same |
| `g/c.txt` to `top.txt` (repo root) | `R100` (new path outside the filter) | same |
| `g/b.txt` to `g/b.bak` or `g/f.txt` to `g/f.txt.old` | **`D` only** (git hides the other side) | `R100` |
| `g/d.txt` to `g/d.md` | `R100` across extensions | same |
| Rename with more than half the lines changed (`R040`) | `D` plus `A` (new `deck_id`) | `D` plus `A` |

* The pathspec makes git treat a move to a non-matching extension as a plain delete. Both outcomes end in the same version row (`D`) under the corrected rule, so the pathspec needs no change.
* The design's pathspec matches nested files too (`*.txt` crosses `/`), so the path filter in the app is required, not optional. The design already says this; the tests confirm no leaks.
* A rename plus large edit (similarity below git's 50% default) shows as `D` plus `A`, and the deck gets a new `deck_id` and loses its link to its earlier versions. Adding `-M30%` pairs `R040` correctly in the probe. It has a cost: unrelated decks that are deleted and added in the same commit with at least 30% shared lines would be linked. **Proposal:** keep the default and add this sentence to the Status rules: "A rename combined with an edit of more than about half of the file shows up as `D` and `A` and starts a new `deck_id`." If the product owner prefers continuity, use `-M30%`. Not changed in the scripts.
* Identical content causes arbitrary pairing. When two decks have byte-identical content (for example a copied deck) a rename in the same commit can be paired with the wrong partner (seen in the first probe: `g/a.txt` paired with `g/d.md`). Real decks rarely collide, but "copy a deck, then rename the original" in one commit can swap histories. Accept and document.

### 3. Raw output framing is not exactly as described

The design says each record starts with `\x1e` and the raw entries are NUL-separated. The exact stream is:

```text
\x1e<sha>\x1f<name>\x1f<aI>\x1f<cI>\x1f<subject>\0\n:<oldmode> <newmode> <oldsha> <newsha> <status>\0<path>\0[<path2>\0]:<...>
```

* With `-z` the format line ends with a NUL, followed by one `\n`, then the entries; the next record follows directly with `\x1e` (no newline between records).
* `status` is `R100`-style for renames; read only its first letter. `R` entries carry two paths.
* A commit with no matching entry (after pathspec simplification) is not printed at all, so `seq` only counts commits that have a kept entry. This must be stated, because commits that touch only nested `.txt` files are printed but have no kept entry.
* For a deleted file the new sha is all zeros; store NULL.

**Proposed replacement for the "Record format" bullet:**

```text
* **Record format:** each commit record starts with `\x1e`. Its fields (`%H`, `%an`, `%aI`, `%cI`, `%s`) are separated by `\x1f`
  and the header ends with a NUL. A `\n` follows, then the `--raw -z` entries: `:<old mode> <new mode> <old sha> <new sha> <status>`
  NUL `<path>` NUL (and `<path2>` NUL for `R` and `C`), with no separator between entries or between records.
  The status letter is the first character of the status field (`R100` is `R`). A deleted file has an all-zero new SHA, stored as NULL.
  A subject cannot contain NUL, but the parser must not assume `\x1e` or `\x1f` never occurs in a subject: split the header into at most
  four fields on `\x1f` and treat the rest as the subject.
```

### 4. Merges under `--first-parent`

Confirmed: with `--first-parent`, `git log --raw` prints the merge's diff against its first parent (1 raw line for the probe merge; without `--first-parent` it prints 0 lines). Entries for 150 sampled merges equal `git diff-tree -M <merge>^1 <merge>` exactly, including renames made on the feature branch. The author and dates are those of the merge commit (the person who merged, or the merge bot); a squash merge carries the PR author. The design's text is correct; add this sentence to make the author-date behaviour explicit: "`author_date` of a merge version is the merge commit's author date (the time of the merge), not the feature branch's." Also note this affects "Date updated" (merge time, which is the useful date).

### 5. Range end and `last_commit` race

The design runs `<range>` as `HEAD` or `last_commit..HEAD`. If a sync advances `HEAD` between the `git log` and the `rev-parse` that supplies the new `last_commit`, rows and `last_commit` disagree. **Proposed text:** "Resolve `HEAD` to a SHA once (`newHead`) at the start of the pass, run the command with `<range>` = `newHead` or `last_commit..newHead`, and store `newHead` as `last_commit`." This is what `fullRebuild` and `incremental` do, and `updateHistory(git, db, newHead)` in item 66 already takes `newHead`.

### 6. Smaller points

* **`seq` and `kind` key:** a commit that changes a deck's `.txt` and `.md` writes two rows with the same `seq` and different `kind`, which fits the primary key. "Date updated" and "version list" should group by `seq`, not count rows (a 10-file commit is one `seq`, a commit touching `.txt` and `.md` of one deck is one version with two rows). Add to the Pages bullet: "One version is one `seq` for a deck; its `.txt` and `.md` rows share that `seq`."
* **Primers with no deck:** an `.md` whose `.txt` does not exist yet is skipped (rule 1), so a primer committed before its deck has no version row until its next change. The blob is still readable at HEAD. If this matters, the alternative is to create decks from primer events too, at the cost of orphan decks.
* **`author_date` ordering:** `%aI` keeps the committer's timezone offset, so the string maximum of "newest `author_date`" is wrong when offsets differ (`2024-01-01T10:00:00+02:00` sorts after `2024-01-01T09:00:00Z`, but is earlier). Store a normalised UTC value (`%aI` converted to UTC, or add a `author_ts` integer from `%at`) and take the maximum of that. Item 66's `lastUpdated` should do the same. The scripts store `%aI` as documented and do not fix this.
* **Rename limit:** git 2.56 detected 1,500 inexact renames in one commit with the default `diff.renameLimit`, so a large reorganisation commit is not a concern for this version. The wrapper still passes `-c diff.renameLimit=0` in the spike; item 52 may want the same as a guard against git versions with a lower default limit (when the limit is exceeded git skips inexact rename detection and reports `D` plus `A`). This was not tested on an older git.
* **`git diff --name-status -M` in item 52 (`diffNameStatus`)** was not tested here.

## Open issues

* The timings come from one machine with a warm cache and local SSD. A volume with slow fsync (network disk) raises the insert time, not the git time. One commit is one fsync, so the cost stays at one transaction per update.
* The generated repo has short decks (about 25 lines) and about 18% merges. Real repos with large primers or much bigger blobs would only change the `git log` output size, not the number of commits.
* The rename-plus-heavy-edit case (new `deck_id`) is a product decision: keep, or use `-M30%`.
* The orphan-primer and md-only decks rule (point 6) is not decided by the design. The scripts skip them.
* `deck_versions.status` for a deck re-created by an `R` with no known source is recorded as `A`. Does not occur in the generated data.
* Not tested: submodules, symlinks or mode-only changes (type change `T` is treated as `M`), commits whose paths contain newlines or tabs (`-z` handles them, the parser was not exercised on them), and shallow clones (the design clones fully).
* Throughput was not measured past 3,000 commits. Extrapolating linearly, 100,000 commits would take roughly 8 s to rebuild.

## Files

* `spikes/git-history/generate.ts`, `history-pass.ts`, `verify.ts`, `bench.ts`, `.gitignore`
* Generated, ignored: `spikes/git-history/out/` (repo, databases, `verify-results.txt`, `bench-results.txt`, probe repos)
