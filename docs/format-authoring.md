# Writing a format

A format says which cards a deck may contain and how big the deck may be. This guide shows how to write a custom format for a deck repo: a file `formats/<name>.yaml`. The exact rules are in [spec/format-definition.md](../spec/format-definition.md). If this guide and the specification differ, the specification is right.

Use a custom format when no official format fits, for example a cube, an old-school list, or a community format such as 2015 Modern. For an official format, write `format: modern` (or another official name) in `gauntlet.yaml` and write no file.

## Where a format lives

| Kind     | Where                                         | Reference in `gauntlet.yaml` |
| -------- | --------------------------------------------- | ---------------------------- |
| Preset   | `presets/<id>@<revision>.yaml` in TCG Gauntlet | `preset:2015-modern@1`       |
| Repo     | `formats/<file>.yaml` in your deck repo        | `repo:formats/cube.yaml`     |
| Official | no file; MTGJSON decides                       | `official:modern` or `modern` |

The prefix decides where the app looks. A deck repo cannot define a `preset:` name and cannot replace a preset. Only files directly in `formats/` that end in `.yaml` are read.

## A complete example

This is the example from the specification. Save it as `formats/tiny-cube.yaml`:

```yaml
schema_version: 1
id: tiny-cube
name: Tiny cube
legality_by: name
sets: [M15, KTK, FRF, DTK, ORI]
banned:
  - Treasure Cruise
restricted:
  - Monastery Swiftspear
include:
  - name: Tarmogoyf
    reason: Allowed as a special case, although no listed set prints it.
deck:
  min_main: 40
  max_sideboard: 10
```

Use it in a gauntlet:

```yaml
schema_version: 1
name: Tiny cube gauntlet
format: repo:formats/tiny-cube.yaml
```

Run the validator to check the format and the decks (see [deck-repo-guide.md](deck-repo-guide.md#run-the-validator-on-your-machine)). A format file with a mistake gives `E-SCHEMA-INVALID` or `E-FORMAT-INVALID`, and the decks of the gauntlet are not checked until it is fixed.

## The fields

| Field            | Required | Meaning                                                                                                        |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `schema_version` | yes      | Must be `1`.                                                                                                   |
| `id`             | yes      | Lower-case letters, digits and hyphens, up to 40 characters. For a repo format it is a label only.            |
| `name`           | yes      | The name people see, 1 to 120 characters.                                                                      |
| `legality_by`    | yes      | Must be `name`. See [Legality is by name](#legality-is-by-name).                                               |
| `sets`           | yes      | 1 to 500 set codes, in upper case, 2 to 6 letters or digits, no repeats.                                       |
| `banned`         | no       | Card names that are never legal.                                                                               |
| `restricted`     | no       | Card names that are legal, with at most 1 copy in main deck and sideboard together.                           |
| `include`        | no       | `{name, reason}` items. These cards are in the pool although no listed set prints them.                       |
| `exclude`        | no       | `{name, reason}` items. These cards are out of the pool although a listed set prints them.                    |
| `deck`           | no       | Deck size and copy limits.                                                                                     |

Unknown fields are an error. `include` and `exclude` need both `name` and `reason`. The `reason` is for people: write why the card is there.

The `deck` fields are integers from 0 to 250. Their defaults:

| Field           | Default                          | Meaning                                                                  |
| --------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `min_main`      | `60`                             | The fewest cards in the main deck.                                       |
| `max_main`      | no limit                         | The most cards in the main deck. It must not be smaller than `min_main`. |
| `max_sideboard` | `15`                             | The most cards in the sideboard.                                         |
| `max_copies`    | `4`                              | The most copies of one card, over main deck and sideboard together.      |
| `copy_exempt`   | `[basic_lands, any_number_text]` | Cards the copy limit does not apply to. An empty list exempts nothing.   |

A cube with one copy of each card sets `max_copies: 1` and `copy_exempt: [basic_lands]`, so basic lands stay unlimited and cards like Relentless Rats do not. The exemption never applies to `restricted`.

## How the pool is built

The pool is the set of card names that are legal in the format:

```text
pool = (every card with a pool printing) + include - exclude - banned
```

A pool printing is a printing that meets all three conditions:

- its set code is in `sets`;
- it is not an Un-set card (MTGJSON `isFunny`), not online-only and not oversized.

Nothing else is tested. The language of the printing does not matter.

MTGJSON gives each promo set its own set code. Listing `M15` does not bring in the promos of `M15`. List the promo set code if you want those cards.

To judge a card, the validator goes in this order:

1. The card is in `banned`: `E-LEGAL-BANNED`.
2. The card is not in the pool: `E-LEGAL-NOT-IN-POOL`.
3. The card is in `restricted` and the deck has more than one copy: `E-LEGAL-RESTRICTED`.

A card in both `include` and `banned` is banned. A card in both `include` and `exclude` is not in the pool.

### Names

Card names in the format and in decks are compared after normalisation: accents removed, lower case, curly quotes made straight, white space collapsed, and split-card separators made uniform (`Fire // Ice`, `Fire/Ice` and `Fire / Ice` are the same). A double-faced or adventure card may be written by its front-face name. A back-face name alone does not match.

Every name in `banned`, `restricted`, `include` and `exclude` must be a real card. A name that is not found gives `E-FORMAT-INVALID`, so a typo cannot silently allow a card.

### Finding set codes

Set codes are MTGJSON's. They are in the column `code` of the `sets` table of `AllPrintings.sqlite`. Most match the codes you see on a card, but not all: some promo and special sets have codes that are longer or use digits. If a code is wrong, the pool is smaller than you expect. Check by putting a card from the set in a deck and running the validator.

## Legality is by name

`legality_by: name` is the only value in version 1. It means that a card is legal when its name is in the pool. The printing that a deck line names does not change legality.

- A deck that lists `4 Lightning Bolt (LEA) 161` is legal in a format whose `sets` do not include `LEA` if some listed set prints Lightning Bolt. The `(LEA) 161` part only chooses which image the site shows.
- A set code and number that do not exist, or that belong to another card, give `E-PRINTING-UNKNOWN`. That is a data error. It does not say anything about legality.
- A line with no set code shows the card's default printing. The default is the oldest English paper printing, and for a custom format it is limited to the listed sets. It only changes what the site displays.

The field `legality_by` is the place for a later version to add formats that check printings. A version-1 tool refuses any other value.

## Why `sets` is a list of set codes and not a date range

A date range looks shorter: "everything from Eighth Edition to Magic Origins". It is not exact at the edges:

- A set released on the boundary date can fall on either side.
- Promos and supplemental products have release dates inside the range, and they may or may not be part of the format.

A list of set codes gives an exact pool that anyone can read and review. The [2015 Modern preset](../presets/2015-modern@1.yaml) lists its 49 sets by code. The pool was compared with the format's own source, name by name (see [the spike](spikes/modern-2015-pool.md)): it has 9,186 names and no difference.

## Format keys

The app and the validator name a format by its **format key**, so that a change to a definition is a different format:

```text
<ref>#<hash12>
```

- `<ref>` is the reference from `gauntlet.yaml`, with a bare official name written as `official:<name>`.
- For an official format the suffix is the text `mtgjson`: `official:modern#mtgjson`.
- For a custom format, `<hash12>` is the first 12 hexadecimal characters of the SHA-256 of the definition's canonical JSON.

The canonical JSON is made like this:

1. Parse the definition and fill in every default, including `copy_exempt`. `max_main` has no default and is left out when it is missing.
2. Sort `sets`, `banned`, `restricted` and `copy_exempt` by Unicode code point.
3. In `include` and `exclude`, remove each `reason`, and sort the items by `name`.
4. Write it as JSON in the canonical form of RFC 8785 (JCS): keys sorted, no white space, numbers in ECMAScript form.

For the `tiny-cube` example above, the canonical JSON is:

```json
{"banned":["Treasure Cruise"],"deck":{"copy_exempt":["any_number_text","basic_lands"],"max_copies":4,"max_sideboard":10,"min_main":40},"exclude":[],"id":"tiny-cube","include":[{"name":"Tarmogoyf"}],"legality_by":"name","name":"Tiny cube","restricted":["Monastery Swiftspear"],"schema_version":1,"sets":["DTK","FRF","KTK","M15","ORI"]}
```

Its format key is `repo:formats/tiny-cube.yaml#48c390f01036`.

What changes the key and what does not:

| Change                                              | Key changes? |
| --------------------------------------------------- | ------------ |
| Add, remove or rename a set, a card or a deck rule  | yes          |
| Change `id`, `name` or `schema_version`             | yes          |
| Change a `reason`                                   | no           |
| Reorder a list, or add a YAML comment               | no           |
| Write a default value that was already the default  | no           |
| Rename the file and the `format` reference          | yes          |

Names in the lists are hashed as written. They are not normalised first, so changing `Tarmogoyf` to `tarmogoyf` changes the key although it names the same card.

The key matters in two places. The app builds a table of the pool for each key, so a changed definition gets a new table. And the validator output and `/status` show the key, so you can tell whether two runs used the same definition. `--output json` has the key of each checked file in `formatKey`.

## Presets and old versions

A preset is a format that ships with TCG Gauntlet. A released preset file never changes. A correction is a new revision in a new file, so `preset:2015-modern@1` means the same pool at any time. The rules for adding a revision are in [presets/README.md](../presets/README.md).

Your own formats in `formats/` can change at any time. The change gives a new key, and the decks are checked against the new pool.

MTGJSON does not keep old versions. A custom format decides legality from its own lists and its set codes. A reprint in a set that is not listed does not change the pool. An official format follows MTGJSON legality as of today, so its verdicts can change when the banned list changes. If you need a verdict that stays fixed, use a preset or a custom format.
