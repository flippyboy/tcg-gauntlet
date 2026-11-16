# Format definitions

A **format** says which cards a deck may contain and how big the deck may be. There are two kinds:

- An **official format** has no definition file. Its card legality comes from MTGJSON.
- A **custom format** is described by a format definition file, in YAML, checked against [format-definition.v1.schema.json](schemas/format-definition.v1.schema.json). Custom formats decide legality by card name, from an explicit list of sets.

A gauntlet names its format in the `format` field of `gauntlet.yaml` (see [gauntlet.md](gauntlet.md)).

## Where definitions live

- **Presets** ship with the tool. A preset is the file `presets/<id>@<revision>.yaml` in the tool's own repo. A released preset file never changes. A change is a new revision in a new file.
- **Deck repo formats** are files under `formats/` in the deck repo, referred to as `repo:formats/<file>.yaml`.
- A deck repo cannot define a `preset:` ID, so it cannot override a preset.

## Fields

The file is YAML 1.2. No other fields are allowed.

| Field            | Type             | Rule                                                                                                                |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | integer          | Required. Must be `1`.                                                                                              |
| `id`             | string           | Required. Matches `^[a-z0-9-]{1,40}$`.                                                                              |
| `name`           | string           | Required. 1 to 120 characters.                                                                                      |
| `legality_by`    | string           | Required. Must be `name`. This is the only value in v1. It is the extension point for formats that check printings. |
| `sets`           | array of strings | Required. 1 to 500 unique set codes, each matching `^[A-Z0-9]{2,6}$`.                                               |
| `banned`         | array of strings | Optional. Unique card names. Default: empty.                                                                        |
| `restricted`     | array of strings | Optional. Unique card names. Default: empty.                                                                        |
| `include`        | array of objects | Optional. Each item is `{name, reason}` and both keys are required. Default: empty.                                 |
| `exclude`        | array of objects | Optional. Each item is `{name, reason}` and both keys are required. Default: empty.                                 |
| `deck`           | object           | Optional. See below.                                                                                                |

`deck` fields are all optional integers from 0 to 250:

| Field           | Default                          | Meaning                                                                                                         |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `min_main`      | `60`                             | The fewest cards in the main deck.                                                                              |
| `max_main`      | none (no upper limit)            | The most cards in the main deck.                                                                                |
| `max_sideboard` | `15`                             | The most cards in the sideboard.                                                                                |
| `max_copies`    | `4`                              | The most copies of one card, over main deck and sideboard together.                                             |
| `copy_exempt`   | `[basic_lands, any_number_text]` | Which cards the copy limit does not apply to. A subset of `basic_lands` and `any_number_text`, without repeats. |

`include`, `exclude` and each item of `deck` allow no other fields. Strings in `banned`, `restricted`, and the `name` and `reason` of `include` and `exclude` items must not be empty.

Defaults are filled in after the schema check. A missing `deck` object has all the defaults.

### Rules beyond the schema

A definition that passes the schema but breaks one of these rules gives `E-FORMAT-INVALID`:

- `max_main`, when present, is not smaller than `min_main`.
- Every name in `banned`, `restricted`, `include` and `exclude` identifies a card, using the name matching below.
- For a preset, `id` equals the `<id>` in the reference (see Format references).

A card may appear in more than one list. The precedence is in the next section.

### Meaning of the lists

- `banned`: the card is never legal.
- `restricted`: the card is legal if it is in the pool, but at most 1 copy is allowed, counted over main deck and sideboard together. A restricted card that is not in the pool is not legal.
- `include`: the card is in the pool even if it has no pool printing. The `reason` is documentation for people. It is not read by the rules.
- `exclude`: the card is not in the pool, even if it has a pool printing. The `reason` is documentation.
- `copy_exempt`: `basic_lands` exempts cards with the supertype Basic. `any_number_text` exempts cards whose rules text contains "A deck can have any number of cards named" (for example Relentless Rats). Cards with a different limit in their text, such as Seven Dwarves, are not exempt. An empty list exempts nothing. The exemption applies to `max_copies` only, not to `restricted`.

## Name matching

Card names in a format definition and in deck files are matched the same way. Both sides are normalised, then compared.

Normalisation, in this order:

1. Apply Unicode NFKD, then remove all combining marks.
2. Convert to lower case.
3. Replace `‘` and `’` with `'`, and `“` and `”` with `"`.
4. Collapse each run of whitespace to one space, and remove leading and trailing whitespace.
5. Rewrite every split separator as `//`. A split separator is one `/` or two `//`, with any amount of whitespace, including none, on either side.

A name identifies a card when its normalised form equals the normalised form of any of these:

- the card's full MTGJSON `name` (for a split card, `Wear // Tear`);
- for a double-faced card or an adventure card, the name of its front face (for example `Delver of Secrets` for `Delver of Secrets // Insectile Aberration`).

A name that matches no card is not found. A back-face name alone is not accepted.

## The card pool

The pool is the set of card names that are legal by name in a custom format.

> pool = (every card with at least one pool printing) + `include` - `exclude` - `banned`

A **pool printing** of a card is a printing that meets all of these:

- its set code is listed in `sets`;
- it is not a funny printing (an Un-set card);
- it is not online-only;
- it is not oversized.

How the rule is read:

- The three tests use MTGJSON's `isFunny`, `isOnlineOnly` and `isOversized` fields. MTGJSON stores a flag as NULL when it is false. A NULL flag counts as false, so a printing with a NULL flag passes the test. Doing otherwise would remove every card.
- Promo printings are not tested separately. MTGJSON gives each promo set its own set code, and a promo printing counts only when its own set code is in `sets`. Listing a core set or an expansion never brings in the promos of unlisted sets.
- The language of a printing does not matter.
- Tokens are not cards in MTGJSON, so they are never in the pool.
- Names are matched as in "Name matching". A double-faced card is in the pool when any of its faces has a pool printing, and its entries in `banned`, `restricted`, `include` and `exclude` may use its front-face name.
- `banned` is applied last, so a card in both `include` and `banned` is banned. A card in both `include` and `exclude` is not in the pool.

How a card is judged in a custom format, in this order:

1. If the card is in `banned`: `E-LEGAL-BANNED`.
2. Otherwise, if the card is not in the pool: `E-LEGAL-NOT-IN-POOL`. A card is "not in the pool" when it has no pool printing and is not listed in `include`, or when it is listed in `exclude`.
3. Otherwise the card is legal. If it is in `restricted` and the deck has more than 1 copy in total: `E-LEGAL-RESTRICTED`.

## Deck rules

For a deck in a format with these rules:

- The main deck must have at least `min_main` cards and, when `max_main` is set, at most `max_main` cards. Otherwise: `E-DECK-MAIN-SIZE`. The size is the sum of the counts of all main-deck lines.
- The sideboard must have at most `max_sideboard` cards. Otherwise: `E-DECK-SIDEBOARD-SIZE`. `Companion` cards count as sideboard.
- A card may have at most `max_copies` copies, counted over the main deck and the sideboard together. Cards exempt under `copy_exempt` are not limited. Otherwise: `E-DECK-COPIES`.
- A `Commander` section is not allowed in any v1 format: `E-DECK-SECTION`.

## Official formats

`official:<name>` uses MTGJSON's legality column for that format and the deck rules in this table. The formats are `standard`, `pioneer`, `modern`, `legacy`, `vintage` and `pauper`.

| Formats                                             | Main deck  | Sideboard   | Copies | Other                                                        |
| --------------------------------------------------- | ---------- | ----------- | ------ | ------------------------------------------------------------ |
| `standard`, `pioneer`, `modern`, `legacy`, `pauper` | 60 or more | 15 or fewer | 4      | none                                                         |
| `vintage`                                           | 60 or more | 15 or fewer | 4      | Cards that MTGJSON marks `Restricted` are limited to 1 copy. |

Commander is not supported in v1. It needs a commander zone, singleton rules and color-identity checks.

The `copy_exempt` default (`basic_lands` and `any_number_text`) applies to official formats too.

MTGJSON legality values map as follows:

| MTGJSON value                                         | Result     |
| ----------------------------------------------------- | ---------- |
| `Legal`                                               | legal      |
| `Restricted`                                          | restricted |
| `Banned`, `Not Legal`, a missing value, anything else | not legal  |

A card that is not legal gives `E-LEGAL-BANNED` when the MTGJSON value is `Banned`, and `E-LEGAL-NOT-IN-POOL` otherwise. A restricted card has at most 1 copy over main deck and sideboard together, otherwise `E-LEGAL-RESTRICTED`.

Official legality is current. It can change when the rules of the game change, so a verdict for an official format can differ between two versions of MTGJSON.

**Combining printings.** MTGJSON stores legality on every printing row, and the rows for one card can differ. For example, some printings have no value where others say `Restricted`.

1. Take every row of the card.
2. Ignore rows where the value is missing.
3. Of the remaining values, `Banned` wins over `Restricted`, and `Restricted` wins over `Legal`.
4. If every row is missing, the card is not legal.

## Format references and format keys

The `format` value of `gauntlet.yaml` is a **format reference**. It is normalised first:

- `preset:<id>@<n>`, `repo:formats/<file>.yaml` and `official:<name>` stay as they are.
- A bare official name, such as `modern`, becomes `official:modern`.

The prefix alone decides the namespace. There is no search order or precedence between namespaces: `preset:`, `repo:` and `official:` never refer to each other's definitions.

Resolution:

- `preset:<id>@<n>` is the file `presets/<id>@<n>.yaml` shipped with the tool. If the tool has no such file: `E-FORMAT-UNKNOWN`. The file's `id` must equal `<id>`, otherwise `E-FORMAT-INVALID`.
- `repo:formats/<file>.yaml` is that file in the deck repo, at its root. If it does not exist: `E-FORMAT-UNKNOWN`. The `id` of a repo definition is a label. It is not compared with the file name.
- `official:<name>` has no file.

### Format keys

The **format key** names a format together with its exact content, so that a change to a definition is a different key. It is `<ref>#<hash12>`, for example `preset:2015-modern@1#3f9a01c2b7de`.

- `<ref>` is the normalised format reference.
- For an official format, the suffix is the fixed text `mtgjson`: `official:modern#mtgjson`.
- For a custom format, `<hash12>` is the first 12 lower-case hexadecimal characters of the SHA-256 of the UTF-8 bytes of the canonical JSON of the definition. The canonical JSON is made like this:
  1. Parse the definition and fill in all defaults, including `copy_exempt`. `max_main` has no default, so it is left out when missing.
  2. Sort `sets`, `banned`, `restricted` and `copy_exempt` as lists of strings, by Unicode code point order.
  3. In `include` and `exclude`, remove `reason` from every item, so each item is `{"name": ...}`, and sort the items by `name`, by code point order.
  4. Write the result as JSON in the canonical form of RFC 8785 (JSON Canonicalization Scheme): object keys sorted, no whitespace, numbers in ECMAScript form.

Names in the lists are used as written. They are not normalised before hashing. `schema_version`, `id` and `name` are part of the hashed document, so renaming a definition changes its key. Changing only a `reason`, the order of a list, or a YAML comment does not change the key.

## Example

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

This example uses the five newest sets of 2015 Modern. Defaults fill in `max_copies: 4` and `copy_exempt: [basic_lands, any_number_text]`.
