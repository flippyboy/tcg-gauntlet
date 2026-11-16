# Contributing

## Editing workflow

1. Create a branch from `main`.
2. Add or change deck files (`.txt`) and, if you like, their primers (`.md`).
3. Run the validator on your machine (see below), or let the pull request run it.
4. Open a pull request into `main`. The `validate` check must pass before it can be merged.
5. Merge the pull request. Only merged changes appear on the site and in a deck's history.

## The deck file format

A deck is a file `<name>.txt` directly inside a gauntlet folder, with an optional block of YAML front matter and then one card per line:

```text
---
name: Burn
author: Your Name
---
4 Lightning Bolt
4 Goblin Guide (ZEN) 126
SB: 2 Rest in Peace
```

- `4 Card Name` and `4x Card Name` both work. A line may name a printing, as `(SET) number`.
- A card is in the sideboard when its line starts with `SB:`, when it comes after a `Sideboard` header, or when it comes after the first blank line that follows the main deck.
- Lines that start with `//` or `#` are comments.

The complete rules are in the TCG Gauntlet specification:

- [Deck file](https://github.com/flippyboy/tcg-gauntlet/blob/main/spec/deck-file.md)
- [Gauntlet folders and gauntlet.yaml](https://github.com/flippyboy/tcg-gauntlet/blob/main/spec/gauntlet.md)
- [Format definitions](https://github.com/flippyboy/tcg-gauntlet/blob/main/spec/format-definition.md)
- [Error codes](https://github.com/flippyboy/tcg-gauntlet/blob/main/spec/error-codes.md)

## Run the validator locally

You need Docker. Run this in the root of the repo:

```sh
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/w" -w /w \
  -v "$HOME/.cache/tcg-gauntlet:/cache" \
  ghcr.io/flippyboy/tcg-gauntlet-validator:v1 --data-dir /cache --all
```

The first run downloads the card data (about 230 MB) into the cache folder. Later runs only download it again when MTGJSON publishes a new version.

To check only what changed since `main`, use `--changed-since main` in place of `--all`. The exit code is 0 when there are no errors, 1 when a deck has an error, and 2 when the validator could not run.

## Require the `validate` check and pull requests on `main`

Do this once, as a repo admin, after the first push has run the workflow at least once:

1. Open the repo on GitHub, then **Settings**, then **Branches**.
2. Under **Branch protection rules**, choose **Add branch protection rule**. (In newer repos this is **Rules**, then **Rulesets**, then **New branch ruleset**.)
3. Set the branch name pattern to `main`.
4. Turn on **Require a pull request before merging**.
5. Turn on **Require status checks to pass before merging**, then search for `validate` and select it.
6. Turn on **Require branches to be up to date before merging**, so that the check runs on the merged result.
7. Save the rule.

The workflow runs on `pull_request`, with read-only access and no secrets. Pull requests from forks are checked in the same way and cannot reach anything private.
