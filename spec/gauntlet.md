# Deck repo layout and `gauntlet.yaml`

This document defines how a deck repo is laid out, what `gauntlet.yaml` contains, and the limits every tool applies to the files it reads.

## Deck repo layout

A deck repo is a git repo. A **gauntlet** is a top-level folder that contains a file named `gauntlet.yaml`.

```text
modern-2015-example/
  gauntlet.yaml
  gauntlet.md
  burn.txt
  burn.md
formats/
  cube.yaml
```

- Top-level folders without `gauntlet.yaml` are not scanned as gauntlets.
- `formats/` is read for format definitions only.
- `.github/` and every folder whose name starts with a dot are not read.
- Subfolders inside a gauntlet are ignored.
- A deck is a file `<name>.txt` directly inside a gauntlet folder, in the format of [deck-file.md](deck-file.md). `gauntlet.txt` is a reserved name and is not a deck.
- A deck's identity is its path in the repo.
- Files in a gauntlet folder that are not `gauntlet.yaml`, `gauntlet.md`, `*.txt` or `*.md` are ignored.

## `gauntlet.yaml`

The file is YAML 1.2. It is checked against [gauntlet.v1.schema.json](schemas/gauntlet.v1.schema.json).

| Field            | Type    | Rule                                              |
| ---------------- | ------- | ------------------------------------------------- |
| `schema_version` | integer | Optional. Must be `1`. A missing value means `1`. |
| `name`           | string  | Required. 1 to 120 characters.                    |
| `format`         | string  | Required. One of the four forms below.            |
| `description`    | string  | Optional. At most 1,000 characters.               |

No other fields are allowed. An unknown field gives `E-SCHEMA-INVALID`.

### `format`

The value must match this regular expression:

```text
^(preset:[a-z0-9-]{1,40}@[0-9]{1,4}|repo:formats/[A-Za-z0-9._-]{1,100}\.yaml|(official:)?(standard|pioneer|modern|legacy|vintage|pauper))$
```

| Form                     | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `preset:2015-modern@1`   | A preset that ships with the tool.                             |
| `repo:formats/cube.yaml` | A custom format definition in the deck repo, under `formats/`. |
| `official:modern`        | An official format, checked against MTGJSON legality.          |
| `modern`                 | A bare official name. It is the same as `official:modern`.     |

How these references resolve, and what the normalised reference is, is defined in [format-definition.md](format-definition.md).

Example:

```yaml
schema_version: 1
name: 2015 Modern example gauntlet
format: preset:2015-modern@1
description: Three decks that are legal in 2015 Modern.
```

## Sidecar files

- `gauntlet.md` in a gauntlet folder holds the description of the gauntlet.
- `<deck>.md` holds the primer for `<deck>.txt`. Its name is the deck's name with `.md` in place of `.txt`.
- A `.md` file other than `gauntlet.md` with no matching `.txt` gives `W-PRIMER-ORPHAN`.
- A primer or description is not parsed for rules. It is only checked for the size limit below.

## URLs

Folder names and deck names may contain spaces and Unicode characters. When a tool puts them in a URL path, it encodes each path segment as UTF-8 and percent-encodes every byte except the unreserved characters `A-Z a-z 0-9 - . _ ~`. A space becomes `%20`.

## Name collisions

Two deck names in one gauntlet that are the same after converting to lower case give `E-LIMIT-EXCEEDED`. The error is reported on every colliding deck file except the one whose path comes first in byte order.

## Limits

A tool that reads a deck repo applies these limits. Exceeding one gives `E-LIMIT-EXCEEDED`.

| Limit               | Value                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| File size           | 256 KB per file (KB means 1,024 bytes).                                              |
| Card lines per deck | 250. Comments, headers and blank lines don't count. `SB:` lines count.               |
| Line length         | 300 characters for a card line, not counting the line ending.                        |
| Decks per gauntlet  | 200.                                                                                 |
| YAML size           | 64 KB of YAML per file. For front matter, this is the block between the `---` lines. |
| YAML nesting depth  | 10 at most.                                                                          |
| Symlinks            | Refused. A symlink among the files or folders a tool would read is an error.         |

"Characters" are Unicode code points. A file over its limit is not parsed further.

### What a scan does with a file over a limit

A tool that scans a deck repo reports `E-LIMIT-EXCEEDED` on the file and leaves the file out of what it reads:

- A deck over a limit is not a deck in that scan. A primer or `gauntlet.md` over the limit is treated as missing.
- A gauntlet whose `gauntlet.yaml` is over the limit or is a symlink is not scanned. Its decks are not read.
- A gauntlet with more than 200 decks keeps the first 200 in byte order of their paths. The error is reported on its `gauntlet.yaml`.
- For a name collision, the deck that stays is the one whose path comes first in byte order. The others are left out.
- A symlink is an error only where a tool would read it: a top-level entry that points to a folder, `formats`, a file in `formats/` that ends in `.yaml`, and `gauntlet.yaml`, `gauntlet.md`, `*.txt` and `*.md` in a gauntlet folder. Other symlinks are ignored. A tool never follows a symlink.

### YAML parsing

All YAML (front matter, `gauntlet.yaml`, format definitions) is parsed as YAML 1.2 with these rules:

- Aliases and anchors are refused.
- A repeated key in one mapping is an error.
- Input over 64 KB, or nested deeper than 10 levels, is refused.

### Parser safety

The card-line grammar in [deck-file.md](deck-file.md) uses anchored patterns without nested quantifiers, so the matching time grows linearly with the length of the line. An implementation MUST keep that property.

## Deck repo URL grammar

A tool that is told which deck repo to read by URL accepts only an `https://github.com/<owner>/<repo>` URL, optionally ending in `.git` or `/`. It does not accept user info, a query, a fragment or any extra path.

The URL must match this regular expression:

```text
^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}?(\.git)?/?$
```

A repo name that is only `.` or `..` is also refused.

The tool normalises an accepted URL to `https://github.com/<owner>/<repo>`, with the owner and repo in lower case and with no `.git` suffix and no trailing `/`.
