# Presets

A preset is a format definition that ships with TCG Gauntlet. A gauntlet refers to one with `format: preset:<id>@<revision>`, for example `preset:2015-modern@1`. The file format is in [spec/format-definition.md](../spec/format-definition.md).

## Policy

- **Location and name.** A preset lives at `presets/<id>@<revision>.yaml`. The `id` field inside the file must equal `<id>` in the file name. The revision is a positive integer and appears only in the file name.
- **Immutable once released.** A released preset file is never edited, not even to fix a typo or a comment. A change of any kind is a new revision, written as a new file with the next revision number. The old file stays, so `@1` always means the same format.
- **No overrides.** A deck repo cannot define a `preset:` ID. It cannot replace a preset with its own version.
- **A new revision needs all of these before it is merged:**
  1. A comparison against the format's own source, in the way the 2015 Modern set list and banned list were compared against the 2015modern.com card search: build the pool from MTGJSON and check it name by name. Every difference is either fixed or recorded as an `include` or `exclude` entry with a `reason`.
  2. A passing conformance run.
  3. A review by one person other than the author.
- **Changelog.** Each preset has a changelog in this file. Add an entry for every revision.

## Presets

### 2015-modern

2015 Modern is a community format. It allows the core sets and expansions from Eighth Edition (8ED) to Magic Origins (ORI), plus Time Spiral "Timeshifted" (TSB), with the Modern banned list as of the January 19, 2015 Banned & Restricted announcement. Its source is [2015modern.com](https://www.2015modern.com/banned-cards).

Notes that apply to every revision:

- Golgari Grave-Troll is legal. It is not on the banned list.
- The Scryfall query that 2015modern.com links from its legal-sets page has only 31 card exclusions and leaves out Cloudpost. The banned-cards page lists 32 cards, including Cloudpost, so Cloudpost stays banned. Do not change the preset to match the link.
- TSB has set type `expansion` in MTGJSON. Leaving it out would remove 119 cards that the site allows.

Changelog:

- **@1.** Initial revision. 49 sets from 8ED to ORI, the 32 banned cards, no restricted cards, no overrides, and the default deck limits (60 or more main-deck cards, at most 15 sideboard cards, at most 4 copies). The pool built from MTGJSON has 9,186 card names and matches the site's card search name for name. This revision is not released yet. It becomes immutable with the first release that contains it.
