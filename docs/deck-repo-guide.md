# Deck repo guide

This guide is for the people who maintain a deck repo: a git repo on GitHub that holds decks as text files. A deck repo uses the TCG Gauntlet validator to check every pull request. It can also be shown on a TCG Gauntlet site (see [hosting.md](hosting.md)).

The rules for the files are in the specifications. This guide does not repeat them:

- [Deck file](../spec/deck-file.md)
- [Deck repo layout and `gauntlet.yaml`](../spec/gauntlet.md)
- [Format definitions](../spec/format-definition.md)
- [Error and warning codes](../spec/error-codes.md)

## Start a deck repo

Make an empty folder, turn it into a git repo, and run `init` in it:

```sh
mkdir my-decks && cd my-decks
git init -b main
docker run --rm -v "$PWD:/w" -w /w ghcr.io/flippyboy/tcg-gauntlet-validator:v1 init
```

On Linux, the container runs as uid 1000. If your user has another uid, add `--user "$(id -u):$(id -g)"` so that the container can write to the folder and you own the files.

`init` writes the template into the current folder. It never overwrites a file that exists. It prints what it wrote, what it left alone, and the next steps. The option `--format <ref>` changes the format of the example gauntlet, for example `--format modern` or `--format repo:formats/my-format.yaml`. The example decks are only legal in 2015 Modern, so replace them when you change the format.

Then commit, create the repo on GitHub, and push the branch `main`.

You can also copy the files from the [template folder](../template) by hand.

## Layout

```text
modern-2015-example/     A gauntlet: a top-level folder with a gauntlet.yaml.
  gauntlet.yaml          The gauntlet's name and format.
  gauntlet.md            A description of the gauntlet (optional).
  burn.txt               A deck.
  burn.md                The primer for that deck (optional).
formats/                 Custom format definitions, if you need any.
  README.md              How to write one, with a commented example.
.github/workflows/
  validate.yml           The CI check.
README.md
CONTRIBUTING.md
```

The rules:

- A gauntlet is a top-level folder that contains `gauntlet.yaml`. A top-level folder without that file is not read as a gauntlet.
- A deck is a `.txt` file directly inside a gauntlet folder. Subfolders of a gauntlet are ignored.
- A deck's `.md` file with the same name is its primer. The text is shown on the deck page.
- `formats/` holds custom format definitions. Nothing else in it is read.
- `.github/` and folders whose names start with a dot are never read.
- Symlinks in the places that are read are an error.
- Limits: 256 KB per file, 250 card lines per deck, 300 characters per card line, 200 decks per gauntlet. The full list is in [spec/gauntlet.md](../spec/gauntlet.md#limits).

## The files you edit

**`gauntlet.yaml`** has a name, a format and an optional description:

```yaml
schema_version: 1
name: 2015 Modern example gauntlet
format: preset:2015-modern@1
description: An example gauntlet that uses the bundled 2015 Modern preset.
```

`format` is one of:

| Value                    | Meaning                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `preset:2015-modern@1`   | A format that ships with TCG Gauntlet. The list is in [presets/README.md](../presets/README.md). |
| `repo:formats/cube.yaml` | A format definition in this repo. See [format-authoring.md](format-authoring.md).        |
| `official:modern`        | An official format. MTGJSON decides which cards are legal. `modern` alone means the same. |

The official formats are `standard`, `pioneer`, `modern`, `legacy`, `vintage` and `pauper`. Their legality follows MTGJSON as it is today, so a deck can become illegal when the banned list changes.

**A deck** is a list of cards with optional front matter. See [spec/deck-file.md](../spec/deck-file.md). Example:

```text
---
name: Burn
author: Your Name
---
4 Lightning Bolt
4 Goblin Guide (ZEN) 126

SB: 2 Rest in Peace
```

The validator names the line of each problem and gives a code. [spec/error-codes.md](../spec/error-codes.md) lists the codes.

## Run the validator on your machine

Run it from the root of the deck repo:

```sh
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/w" -w /w \
  -v "$HOME/.cache/tcg-gauntlet:/cache" \
  ghcr.io/flippyboy/tcg-gauntlet-validator:v1 --data-dir /cache --all
```

| Option                     | Meaning                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `--all`                    | Check every deck.                                                                                   |
| `--changed-since <ref>`    | Check the decks that changed since a git ref, for example `main`. Use `--all` or this option, not both. |
| `--repo <dir>`             | The deck repo. The default is the current folder.                                                   |
| `--data-dir <dir>`         | Where the MTGJSON card data is cached. The default is `./.tcg-gauntlet-cache`. Mount a folder and keep it between runs. |
| `--output text\|json\|github` | The output form. The default is `text`. `github` writes annotations and a step summary for GitHub Actions. |

The first run downloads the card data, about 230 MB, into the cache folder. Later runs download it again only when MTGJSON has published a new version.

Exit codes: 0 when there are no errors (warnings are allowed), 1 when a deck has an error, 2 when the validator cannot run (no card data, or a bad option).

With `--changed-since`, the validator checks:

- every deck whose `.txt` or `.md` file changed;
- every deck in a gauntlet whose `gauntlet.yaml` or `gauntlet.md` changed;
- every deck in a gauntlet that uses a `repo:formats/...` file that changed or was deleted.

## CI

`init` creates `.github/workflows/validate.yml`. It runs on every pull request and on every push to `main`. It has one job, named `validate`. The job does two steps:

1. `actions/checkout` with `fetch-depth: 0`. The validator needs the history to find the changed files.
2. `uses: flippyboy/tcg-gauntlet/actions/validate@v1`. The `uses:` line must name that Action and a major version tag.

The workflow has `permissions: contents: read` and uses no secrets. It runs on `pull_request`, never on `pull_request_target`. A pull request from a fork runs with a read-only token and cannot reach anything private. Do not change the trigger to `pull_request_target`.

The Action picks what to check:

- On a pull request, it checks what changed since the merge base with the target branch.
- On a push, it checks what changed since the commit before the push.
- When there is no usable base, such as a new branch, it checks every deck.

You can force a full check with `with: all: "true"`. The Action caches the card data with `actions/cache`. The cache key changes once a week. The validator downloads MTGJSON again only when its version changed, so most runs download only a small `Meta.json`.

A run with errors fails the job, adds annotations to the changed files, and writes a table to the job summary.

## Keep `main` clean

Decks should reach `main` only through a pull request that passed the check. GitHub does not enforce this until you turn on branch protection. Do it once, as a repo admin, after the workflow has run at least once, because GitHub lists a status check only after it has seen it:

1. Open the repo on GitHub, then **Settings**, then **Branches**.
2. Under **Branch protection rules**, choose **Add branch protection rule**. In newer repos this is **Rules**, then **Rulesets**, then **New branch ruleset**.
3. Set the branch name pattern to `main`.
4. Turn on **Require a pull request before merging**.
5. Turn on **Require status checks to pass before merging**. Search for `validate` and select it.
6. Turn on **Require branches to be up to date before merging**, so that the check runs on the merged result.
7. Save the rule.

[CONTRIBUTING.md](../template/CONTRIBUTING.md) in the template has the same steps for your contributors.

Why this matters for a hosted site: the site shows the branch it tracks. A deck that is pushed straight to `main` without a check shows up with its errors. The site still shows it, with a badge for the errors.

History follows `main` along the first-parent line. A pull request that is merged with a merge commit counts as one version, with the author and date of the merge. A squash merge counts as one version with the author of the pull request. Do not force-push `main`. The site then rebuilds its history, and the versions that it showed before are gone.

Renaming a deck with `git mv` keeps its history if git detects the rename. A rename together with a large edit in the same commit looks like a delete and a new file, and starts a new history. Rename in one commit and edit in the next.

## Scheduled workflows stop after 60 days

GitHub turns off scheduled workflows in a public repo when the repo has had no activity for 60 days. The template does not use a schedule, so this does not affect it. If you add a scheduled workflow, for example a daily check against the newest MTGJSON data, push a commit or re-enable it in the **Actions** tab when it stops.

## Update the template files

`init` writes the template of the version you ran. It does not change a repo that exists. To get a newer workflow or CONTRIBUTING.md, run `init` in an empty folder and copy what you want, or read the template folder of the release.

The `@v1` tags move with each 1.x release. A new major version can change the rules, the schemas or the error codes. Change `@v1` in `validate.yml` and the image tag in your local command together, and read the release notes first.
