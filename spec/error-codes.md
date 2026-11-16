# Error and warning codes

Every problem a checker reports has a stable code. A code is either an error (`E-`) or a warning (`W-`). Codes are never renamed or reused within a major version.

Each reported problem has these parts:

- the code and its severity;
- the file path, relative to the deck repo root;
- the line number (1-based, counted from the first line of the file), or none when the problem concerns the whole file or the whole deck;
- a message in plain English;
- a suggestion, where one exists.

When problems are listed, those without a line come first, then the rest in order of line number, and for equal lines in order of code.

## Codes

| Code                          | Severity | Meaning                                                                               |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `E-PARSE-LINE`                | error    | A list line doesn't match the grammar.                                                |
| `E-PARSE-FRONTMATTER`         | error    | The front matter is unterminated or isn't valid YAML.                                 |
| `E-SCHEMA-VERSION`            | error    | The `schema_version` value is unknown.                                                |
| `E-SCHEMA-INVALID`            | error    | A `gauntlet.yaml`, format file or front matter breaks its schema.                     |
| `E-CARD-UNKNOWN`              | error    | The card name is not found. The message gives up to 3 suggestions.                    |
| `E-PRINTING-UNKNOWN`          | error    | The set and number don't exist, or they belong to a different card.                   |
| `E-LEGAL-BANNED`              | error    | The card is banned in the format.                                                     |
| `E-LEGAL-NOT-IN-POOL`         | error    | The card is not in the format's pool.                                                 |
| `E-LEGAL-RESTRICTED`          | error    | A restricted card has more than 1 copy.                                               |
| `E-DECK-MAIN-SIZE`            | error    | The main deck is outside the format's size limits.                                    |
| `E-DECK-SIDEBOARD-SIZE`       | error    | The sideboard has more cards than the format allows.                                  |
| `E-DECK-COPIES`               | error    | There are too many copies of a card across main deck and sideboard.                   |
| `E-DECK-SECTION`              | error    | The deck has a section the format doesn't allow, such as `Commander`.                 |
| `E-FORMAT-UNKNOWN`            | error    | The `format` reference doesn't resolve.                                               |
| `E-FORMAT-INVALID`            | error    | The format definition is invalid.                                                     |
| `E-LIMIT-EXCEEDED`            | error    | A size, count or depth limit is exceeded, a symlink is present, or two names collide. |
| `W-FRONTMATTER-UNKNOWN-FIELD` | warning  | The front matter has a field that isn't in the schema.                                |
| `W-PRIMER-ORPHAN`             | warning  | A `.md` file has no matching deck.                                                    |
| `W-MTGA-UNAVAILABLE`          | warning  | A card isn't available on Arena.                                                      |
| `W-STALE-DATA`                | warning  | The card-data refresh failed, so cached data was used.                                |

## How the codes are used

### Parsing

- `E-PARSE-LINE` is reported on the offending line. Parsing continues with the next line.
- `E-PARSE-FRONTMATTER` is reported when the opening `---` has no closing `---`, when the block is not valid YAML 1.2, when it uses a YAML alias, or when it repeats a key.
- `E-LIMIT-EXCEEDED` covers every limit in [gauntlet.md](gauntlet.md): file size, YAML size, YAML nesting depth, card-line count, line length, deck count, symlinks and name collisions.
- A YAML error in `gauntlet.yaml` or in a format file is `E-SCHEMA-INVALID`.

### Schema errors

A checker validates the parsed YAML against the JSON Schema for the file and maps each schema error to a code:

- In deck front matter, an `additionalProperties` error (a field the schema does not list) is `W-FRONTMATTER-UNKNOWN-FIELD`. It is a warning, so the deck can still pass. The message names the field, and the line is the line of that key.
- Every other schema error, in any of the three files, is `E-SCHEMA-INVALID`. The line is the line of the key the error is about, or the line of the first key of the document when the error is about the whole document.
- `E-SCHEMA-VERSION` is checked before the schema. An integer `schema_version` that the tool does not know gives `E-SCHEMA-VERSION`, and the schema is not run. A `schema_version` that is not an integer gives `E-SCHEMA-INVALID`.

Unknown fields in `gauntlet.yaml` and in format definitions are errors (`E-SCHEMA-INVALID`), not warnings.

### Format problems

- `E-FORMAT-UNKNOWN`: a `preset:` reference names a preset the tool does not ship, or a `repo:` reference names a file that is not in the deck repo.
- `E-FORMAT-INVALID`: the definition parsed and passed its schema, but a rule in [format-definition.md](format-definition.md) is broken: the preset `id` does not match its reference, `max_main` is smaller than `min_main`, or a name in `banned`, `restricted`, `include` or `exclude` is not a card.
- If a gauntlet's format gives `E-FORMAT-UNKNOWN`, `E-FORMAT-INVALID`, `E-SCHEMA-VERSION` or `E-SCHEMA-INVALID`, the decks of that gauntlet are not checked.

### Deck problems

- `E-CARD-UNKNOWN`, `E-PRINTING-UNKNOWN`, `E-LEGAL-BANNED`, `E-LEGAL-NOT-IN-POOL` are reported on the card line. If a card appears on several lines, each line is reported.
- `E-LEGAL-RESTRICTED` and `E-DECK-COPIES` are counted over the main deck and the sideboard together, and reported once per card on the first line that names it.
- `E-DECK-MAIN-SIZE` and `E-DECK-SIDEBOARD-SIZE` have no line.
- `E-DECK-SECTION` is reported on the section header line.

### Warnings

- `W-PRIMER-ORPHAN`: a `<name>.md` file in a gauntlet folder has no `<name>.txt` next to it. `gauntlet.md` is never an orphan.
- `W-MTGA-UNAVAILABLE`: an MTG Arena export contains a printing that is not on Arena. The card stays in the exported text.
- `W-STALE-DATA`: the card data could not be refreshed, and a cached copy was used instead.

## Validator exit codes

| Exit code | Meaning                                                               |
| --------- | --------------------------------------------------------------------- |
| `0`       | No `E-` codes were reported. Warnings are allowed.                    |
| `1`       | One or more `E-` codes were reported.                                 |
| `2`       | An infrastructure failure with no usable card data, or a usage error. |
