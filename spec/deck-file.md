# Deck file

A deck is a plain-text file `<name>.txt` that lists cards. It can start with a block of YAML front matter. This document defines how the file is read, how card names are matched, and how a printing is chosen for each card line.

## File

- **Name.** `<name>.txt`. The name `gauntlet.txt` is reserved and is never a deck. The deck's name is the file name without `.txt`.
- **Encoding.** UTF-8. A leading byte order mark (BOM) is removed. Line endings may be CRLF or LF. A CR that is not followed by LF is not a line ending. A line that contains bytes that are not valid UTF-8 gives `E-PARSE-LINE` and is skipped.
- **Line numbers.** Lines are numbered from 1, counted from the first line of the file, so front matter lines count.
- **Whitespace.** In this document, whitespace means spaces and tabs. Leading and trailing whitespace on a list line is ignored.
- **Limits.** 256 KB per file, 250 card lines, 300 characters per card line. See [gauntlet.md](gauntlet.md).

## Front matter

Front matter is optional. It is a block at the very start of the file:

```text
---
name: Burn
author: Example Player
---
4 Lightning Bolt
```

- The block starts when the first line of the file is `---` (trailing whitespace allowed). It ends at the next line that is `---`.
- If the opening `---` has no closing `---`, the file gives `E-PARSE-FRONTMATTER`.
- The text between the two lines is YAML 1.2, read with the YAML rules in [gauntlet.md](gauntlet.md). Text that is not valid YAML gives `E-PARSE-FRONTMATTER`. An empty block is the same as no fields.
- The block is checked against [deck-front-matter.v1.schema.json](schemas/deck-front-matter.v1.schema.json).
- The list starts on the line after the closing `---`.

Fields, all optional:

| Field            | Type             | Rule                                                      |
| ---------------- | ---------------- | --------------------------------------------------------- |
| `schema_version` | integer          | Must be `1`. A missing value means `1`.                   |
| `name`           | string           | 1 to 120 characters. The display name of the deck.        |
| `author`         | string           | At most 120 characters.                                   |
| `archetype`      | string           | At most 60 characters.                                    |
| `description`    | string           | At most 1,000 characters.                                 |
| `tags`           | array of strings | At most 20 items, no repeats, each at most 30 characters. |
| `source`         | string           | Must start with `http://` or `https://`.                  |

If `name` is missing, the display name is the file name without `.txt`.

Errors:

- A field that the schema does not list is reported as the warning `W-FRONTMATTER-UNKNOWN-FIELD`, on the line of that key. The schema rejects such a field with `"additionalProperties": false`, and the checker maps that one kind of error to the warning. See [error-codes.md](error-codes.md).
- Any other schema error is `E-SCHEMA-INVALID`. An unknown integer `schema_version` is `E-SCHEMA-VERSION`.

## The list

The list is read line by line. Each line is one of these, tested in this order:

1. **Blank** (nothing but whitespace).
2. **Comment**: starts with `//` or `#`.
3. **Section header**.
4. **`SB:` line**.
5. **Card line**.

A line that is none of these gives `E-PARSE-LINE`. Parsing goes on with the next line.

### Comments

A line that starts with `//` or `#` is a comment and is ignored. This includes the header lines of `.dec` files, such as `// NAME : Burn`, `// CREATOR : Example Player` and `// FORMAT : Modern`. They are plain comments. Their values are not read.

### Sections

A deck has a main deck and a sideboard. Reading starts in the main deck.

A **section header** is a line that, after trimming, equals one of these words, with an optional `:` at the end, in any letter case:

| Header                      | Section                                        |
| --------------------------- | ---------------------------------------------- |
| `Deck`, `Main`, `Mainboard` | main deck                                      |
| `Sideboard`                 | sideboard                                      |
| `Companion`                 | sideboard (companion cards count as sideboard) |
| `Commander`                 | commander                                      |

- Cards that follow a header belong to its section, until the next header.
- A header that appears again adds to the same section.
- A `Commander` section gives `E-DECK-SECTION` on the header line in every v1 format. Its cards are still read, but they count in neither the main deck nor the sideboard.

**Blank-line sideboard.** This is how MTGO lays out a list. If no section header has been seen yet, the first blank line that comes after at least one card line starts the sideboard. Later blank lines change nothing. Once a header has been seen, blank lines are ignored. A header that comes after a blank-line sideboard has started sets the section as usual.

**`SB:` lines.** `SB:` followed by one or more whitespace characters and then a card line puts that one card line in the sideboard, whatever the current section is. `SB:` is matched in any letter case. It does not change the current section. `SB:  2 [] Wear / Tear` (two spaces) and `SB: 2 Wear // Tear` are both valid.

### Card lines

A card line is:

```text
<count> [<hint>] <name> [(<SET>) [<number>]]
```

The parts, from left to right:

1. **Count.** One to three digits, not starting with 0 (`[1-9][0-9]{0,2}`), optionally followed by `x` or `X`. Whitespace follows. So `4 Name` and `4x Name` are the same.
2. **Hint** (optional). A set code in square brackets, then whitespace. This is the Magic Workstation form used in `.dec` files: `4 [M11] Lightning Bolt`, or `4 [] Lightning Bolt` when the code is empty. The code has 0 to 6 ASCII letters and digits, in any letter case.
3. **Name.** The card name.
4. **Set code** (optional). A set code in parentheses, written after the name with whitespace before the `(`. The code has 2 to 6 ASCII letters and digits, in any letter case.
5. **Collector number** (optional, only after a set code). Whitespace, then the number.

How the name ends:

- Find the last whitespace character that is followed by `(` in the text after the count and the hint.
- If the text after that `(` is a set code followed by `)`, then it is the set code. Everything before it, without trailing whitespace, is the name. The rest of the line after `)` must be empty, or whitespace followed by a collector number. Anything else gives `E-PARSE-LINE`.
- If there is no such `(`, or the text after it is not a set code and `)`, the name is the rest of the line, without trailing whitespace.

The collector number is made of ASCII letters, ASCII digits, `★`, `-` and `/`. `0` is a valid collector number.

More rules:

- The name must not be empty.
- A line with a hint (even an empty `[]`) and also a trailing `(SET)` gives `E-PARSE-LINE`.
- A card line, with its `SB:` prefix if it has one, is at most 300 characters. A longer line gives `E-LIMIT-EXCEEDED`, and is not parsed further.
- A deck has at most 250 card lines, `SB:` lines included. More gives `E-LIMIT-EXCEEDED`.

Each card line produces: the count, the name as written, the hint, the set code, the collector number, the section, and the line number.

### Name matching

A name is matched against MTGJSON card names after normalisation. The rule is the same for decks and format definitions, and is written once in [format-definition.md](format-definition.md#name-matching). In short:

- Names are compared without regard to letter case, accents, curly quotes and the amount of whitespace.
- A split card is written `Wear // Tear`. `Wear/Tear` (MTGO), `Wear / Tear` (`.dec`) and the same with other spacing are accepted.
- A double-faced card or an adventure card may be written by its front-face name, for example `Delver of Secrets`.

A name that matches no card gives `E-CARD-UNKNOWN`. The message gives up to 3 close names.

### Printings

A card line without a set code and without a usable hint uses the card's **default printing**, defined below. The default printing affects only what is shown, never legality in a format that checks legality by name.

A card line with a set code uses that printing:

- With a collector number, the printing is the one in that set with that number (compared as text, ignoring letter case). It must be a printing of the named card.
- Without a collector number, it is the card's printing in that set with the lowest collector number, ordered as in rule 3 and 4 of the default printing order below.
- If the printing does not exist, or belongs to a different card, the line gives `E-PRINTING-UNKNOWN`, and the default printing is used.
- Set codes are compared without regard to letter case, against MTGJSON set codes.
- When several rows exist for one set and number (one for each language), the English one is used.

A hint is used the same way as a set code without a collector number, but only when it is an MTGJSON set code that has the card. Any other hint is ignored, without an error. Magic Workstation codes such as `9E` are often not MTGJSON codes.

### Default printing

**Qualifying printings.** A printing qualifies when all of these hold:

1. Its MTGJSON `availability` includes `paper`.
2. It is not online-only, funny or oversized (`isOnlineOnly`, `isFunny`, `isOversized`). A NULL flag counts as false.
3. It is a front-face row: `side` is NULL or `a`. A back face is never picked.
4. Its `language` is `English`.
5. It is not a promo (`isPromo`), unless the card has no non-promo printing that meets the other conditions.
6. For a custom format, its set is listed in the format's `sets`.

If no printing qualifies, condition 6 is dropped and the choice is made again. This happens for cards that a format lists in `include` but that no listed set prints. If still none qualifies, the card has no default printing: it is shown by name, and exports leave out the set code.

**Order.** The qualifying printings are sorted by these keys, and the first one wins:

1. Release date, oldest first. This is the card's `originalReleaseDate` when it has one, otherwise its set's `releaseDate`. Dates are `YYYY-MM-DD` text, compared as text.
2. Set type: sets of type `core` or `expansion` before all other sets.
3. The numeric part of the collector number, ascending. This is the first run of ASCII digits in the number. A number with no digits sorts after all numbers with digits.
4. The collector number as text, by Unicode code point order.
5. The MTGJSON `uuid`, as text.

**Stability.** A new printing is always newer than the existing ones, so it never changes which printing is the oldest. The default stays the same over time.

## Edge cases

These rules settle cases that the sections above leave open.

- **Blank-line sideboard.** Only a successfully parsed plain card line arms the blank-line sideboard rule. `SB:` lines and malformed lines do not.
- **Line limits.**
  - The 300-character limit applies to the trimmed line, and an `SB:` prefix counts toward it.
  - The 250-card-line limit counts successfully parsed card lines. The 251st gives `E-LIMIT-EXCEEDED` once, and parsing stops.
- **Front matter.**
  - An unterminated front-matter block means no list is read at all.
  - A block that is invalid YAML gives `E-PARSE-FRONTMATTER`, and the list is still parsed with empty front matter.
- **Odd card lines.**
  - `4 []` with nothing after the brackets is a card named `[]`, which then gives `E-CARD-UNKNOWN`.
  - A `(SET)` marker needs whitespace before the `(`.
  - A name that starts with `(` is never split.
- **Split-card separators.** In a name, each run of one or two slashes, with any spacing around it, is a split-card separator. Three or more slashes in a row are not a separator.
- **Split-card names.** Cards with layout `split` or `aftermath` must be written with both names. Every other multi-face layout may be written with its front-face name.
- **Card type.** A modal double-faced card is typed by its front face. For example, Sink into Stupor is an Instant.
- **Commander sections.** Cards in a `Commander` section are resolved, so unknown names are reported. They are not legality-checked and are not counted in any section.
- **Copy counting.** Copies are counted per card, not per spelling, so `Wear/Tear` and `WEAR // TEAR` count together.
  - A card can get both `E-LEGAL-RESTRICTED` and `E-DECK-COPIES`.
  - A banned card with too many copies gets both `E-LEGAL-BANNED` and `E-DECK-COPIES`.
- **Collector numbers.** Matching uses the front-face row, preferring English. The numeric part sorts first, then the number as text, including any `★`.
- **Schema errors.** An error about the whole document is reported on the line of its first key. Identical errors are reported once.
- **Exports.**
  - Lines for the same card are merged: by name in MTGO and `.dec`, and by name plus printing in MTGA.
  - Cards are written in group-by-type order.
  - **MTGA printing.** Only the MTGA export prefers a printing that is on Arena. The deck page, validation, and the MTGO and `.dec` exports use the resolved printing.
    - A line without a set code is written with the card's Arena printing. That is the newest printing (original release date if present, else the set's) that is a front-face row, English, and has `arena` in its availability. Ties go to core and expansion sets first, then the numeric part of the collector number ascending, then the number as text, then the uuid. If the card has no Arena printing, the resolved printing is used and `W-MTGA-UNAVAILABLE` is added.
    - A line with a set code keeps its printing. `W-MTGA-UNAVAILABLE` is added when that printing's availability has no `arena`.
    - Set codes and collector numbers are MTGJSON's. MTGJSON has no Arena set code, so a few sets may differ in Arena (Dominaria is `DOM` in MTGJSON and `DAR` in Arena).
  - The `.dec` `NAME` falls back to the file name without `.txt`.
  - Newlines in header values become spaces.

## Examples

All of these parse. Counts are shortened to keep the examples small, so most of them are not complete 60-card decks. Parsing does not check the deck size. Format checks do.

### An Arena export

Arena writes `Deck` and `Sideboard` headers, one set code and collector number per card, and a blank line before `Sideboard`. The blank line is ignored, because a header was seen.

```text
Deck
4 Lightning Bolt (M11) 149
4 Goblin Guide (ZEN) 126
4 Monastery Swiftspear (KTK) 118
4 Burst Lightning (ZEN) 119
4 Arid Mesa (ZEN) 211

Sideboard
2 Rest in Peace (RTR) 18
2 Wear // Tear (DGM) 135
```

### An mtgtop8 MTG Arena list

There are no headers. The single blank line starts the sideboard. Line endings are LF, and the last line has none.

```text
4 Lightning Bolt (M11) 149
4 Goblin Guide (ZEN) 126
4 Monastery Swiftspear (KTK) 118
4 Arid Mesa (ZEN) 211

2 Rest in Peace (RTR) 18
2 Wear // Tear (DGM) 135
```

### An MTGO list with a `Sideboard` line

The `Sideboard` line is a header. The split card is written `Wear/Tear`. Line endings are CRLF.

```text
4 Lightning Bolt
4 Goblin Guide
4 Monastery Swiftspear
4 Arid Mesa
Sideboard
2 Rest in Peace
2 Wear/Tear
```

### An MTGO list with a blank-line sideboard

Both MTGO forms parse. Here the blank line starts the sideboard, because no header has been seen.

```text
4 Lightning Bolt
4 Goblin Guide
4 Monastery Swiftspear
4 Arid Mesa

2 Rest in Peace
2 Wear/Tear
```

### A `.dec` file with `[SET]` and `SB:  N` lines

The header lines are comments. The set code in brackets is a hint, and is empty in `[]`. Two spaces follow `SB:`. `[9E]` is a Magic Workstation code. If it is not an MTGJSON set that has the card, it is ignored. The split card is written `Wear / Tear`.

```text
// Deck file created with mtgtop8.com
// NAME : Burn
// CREATOR : Example Player
// FORMAT : Modern
4 [M11] Lightning Bolt
4 [] Goblin Guide
4 [] Monastery Swiftspear
4 [ZEN] Arid Mesa
1 [9E] Blood Moon
SB:  2 [] Rest in Peace
SB:  2 [DGM] Wear / Tear
```

### A file with front matter and `SB:` lines

```text
---
schema_version: 1
name: Burn
author: Example Player
archetype: Burn
description: Fast red burn with a few sideboard answers.
tags: [aggro, red]
source: https://example.com/decks/burn
---
// Main deck
4 Lightning Bolt (M11) 149
4 Goblin Guide
4x Monastery Swiftspear
4 Arid Mesa (ZEN)
SB: 2 Rest in Peace
SB:	2 Wear // Tear
```

The last line has a tab after `SB:`.
