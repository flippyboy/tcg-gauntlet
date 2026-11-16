# Spike 3: mtgtop8 export layouts

Fetched 2026-11-15 with `curl` (generic User-Agent, at least 1 s between requests).

## Result

The three layouts differ from item 36 and item 16 in several places. All three differences below affect round-tripping.

1. **MTGO `.txt`** marks the sideboard with a `Sideboard` header line and has no blank line. Item 36 says an empty line. Split cards are written `Wear/Tear` (no spaces). CRLF, including after the last line.
2. **`.dec`** is really Magic Workstation (`.mwDeck`) format. It has `// ` comment header lines, `N [SET] Name` card lines (the set code is in square brackets and is often empty, `[]`), and sideboard lines `SB:  N [SET] Name` (two spaces after `SB:`). Split cards are written `Wear / Tear`. CRLF, including after the last line. Item 16's grammar cannot read `[SET]` lines or `Wear / Tear`.
3. **MTGA** is not a file download. It is produced by a hidden iframe request to `mtgarena?d=<deckid>`, which fills a textarea through JavaScript. The text has no `Deck` or `Sideboard` header (the sideboard follows one blank line), LF endings, no trailing newline, real set codes with collector numbers, and `Wear // Tear`. Cards with no Arena printing are dropped, and the count of a dropped card is glued onto the count of the next kept line (a site bug).
4. Double-faced cards are written by front face only in all three formats. This matches item 36.
5. Item 16 already reads the MTGO and MTGA layouts. The only grammar changes needed are for `.dec` (`[SET]`, `SB:` with extra spaces, the `Wear / Tear` split spelling) and the `Wear/Tear` name spelling.
6. Non-ASCII names could not be checked in MTGO/`.dec` (no sample deck had one). The server declares `charset=ISO-8859-1` for all exports, and the localized MTGA text confirms raw Latin-1 bytes (`R\351silience`).

## Samples

Source: Modern event "Unity League finals - Nationals Germany 2026", https://www.mtgtop8.com/event?e=93550&f=MO (found through https://www.mtgtop8.com/format?f=MO). All files are in `conformance/layout-samples/mtgtop8/`, raw bytes unchanged except `*.mtga.txt` (see below).

| Deck id | Deck page | Sideboard | Split card | Double-faced card |
|---|---|---|---|---|
| 910585 | `event?e=93550&d=910585&f=MO` (Living End) | 7 lines | none | Sink into Stupor (main) |
| 910594 | `event?e=93550&d=910594&f=MO` | 8 lines | none | Sink into Stupor (main) |
| 910599 | `event?e=93550&d=910599&f=MO` | 8 lines | Wear // Tear (sideboard) | none |

Files per deck `<id>`:

* `<id>.mtgo.txt`: `GET /mtgo?d=<id>&f=<name>`. Saved unchanged.
* `<id>.dec`: `GET /dec?d=<id>&f=<name>`. Saved unchanged. `f` only supplies the download file name and, for 910585 (which was fetched with a real `f` value), the `NAME`/`CREATOR`/`FORMAT` header lines. For 910594 and 910599, `f=` was empty, so the header has only the first line and the file name is `mtgtop8_deck.*`.
* `<id>.mtga.txt`: the English text taken from `GET /mtgarena?d=<id>`, see "MTGA" below. This is extracted text, not raw server bytes. The server's raw page is an HTML fragment (not kept).

Limitation: only one split card (Wear // Tear) and one double-faced card (Sink into Stupor) were seen. Adventure cards, cards with 3+ names, and non-ASCII names are not in the samples.

## Layouts

### MTGO (`mtgo?d=...`)

* Content-Type `text/plain;charset=ISO-8859-1`, `Content-Disposition: attachment; filename=<f>.txt` (`mtgtop8_deck.txt` if `f` is empty).
* Line endings: CRLF on every line. The last line also ends with CRLF (`...Brotherhood's End\r\n`). No BOM.
* No header and no comment lines.
* Card line: `<count> <name>`, count without `x`, one space. No set codes, no collector numbers.
* Sideboard: a line `Sideboard` (CRLF) directly after the last main card. No blank line anywhere in the file (0 empty lines in all three).
* Split card: `Wear/Tear` (slash, no spaces).
* Double-faced card: front face only, `Sink into Stupor`.
* Ordering: the order of the mtgtop8 deck page (creatures and spells before lands, not alphabetical; in 910599 the main deck begins with the 4-ofs `Ajani`, `Guide`, `Ocelot`, `Ragavan`, `Seasoned`, then `3 Voice of Victory`, then the 1-ofs). The sideboard is not sorted either (`1 Blood Moon`, `3 Obsidian Charmaw`, `2 Clarion Conqueror`, ...). A card in both main and sideboard appears in both places.
* Encoding of non-ASCII names: not observed. Declared ISO-8859-1.

```
4 Seasoned Pyromancer\r\n
...
1 Sunbaked Canyon\r\n
Sideboard\r\n
1 Blood Moon\r\n
...
2 Wear/Tear\r\n
```

### `.dec` (`dec?d=...`)

* Content-Type `text/plain;charset=ISO-8859-1`, `Content-Disposition: attachment; filename=<f>.mwDeck`. The format is Magic Workstation's.
* Line endings: CRLF on every line, including the last.
* Header: `// Deck file created with mtgtop8.com`. With a non-empty `f` the next lines are `// NAME : <deck name>`, `// CREATOR : <player>`, `// FORMAT : <format>` (910585). With empty `f` only the first line appears. No blank line after the header.
* Card line: `<count> [<SET>] <name>`. One space after the count, one space after `]`. The set code is empty (`[]`) for most cards, and set in some (`[M11]`, `[TE]`, `[9E]`, `[ZEN]`, `[KTK]`, `[RTR]`, `[DGM]`, `[NPH]`). The codes are Magic Workstation codes (`9E`, `TE`), not MTGJSON/Scryfall codes (`9ED`, `TMP`). No collector numbers.
* Sideboard: each line is `SB:  <count> [<SET>] <name>` with TWO spaces after `SB:`. There is no header and no blank line between main and sideboard.
* Split card: `Wear / Tear` (single slash with spaces) in `[DGM] Wear / Tear`.
* Double-faced card: front face only.
* Ordering: same as MTGO.
* Non-ASCII: not observed. Declared ISO-8859-1.

```
// Deck file created with mtgtop8.com\r\n
// NAME : Living End\r\n
// CREATOR : Jonasfischer\r\n
// FORMAT : Modern\r\n
4 [] Endurance\r\n
...
SB:  3 [] Clarion Conqueror\r\n
SB:  2 [NPH] Dismember\r\n
```

### MTGA (`mtgarena?d=...`, not a download)

How it is produced:

* The deck page has a button whose handler `AffArena()` sets `MTGA_deck.innerHTML` to `<iframe style="display:none" src=mtgarena?d=<deckid>>`.
* That request (`GET https://www.mtgtop8.com/mtgarena?d=<deckid>`, ISO-8859-1 HTML) returns a `<script>` that runs `parent.document.getElementById("MTGAdecklistEN").innerHTML="..."` for each of six languages (`EN`, `FR`, `DE`, `IT`, `ES`, `PT`). The string uses literal `\n` escapes.
* `CopyMTGA(lang)` copies that textarea to the clipboard (`document.execCommand("copy")`). So the exact text is the string literal in the response, with `\n` turned into LF. `<id>.mtga.txt` holds the `EN` string that way (the `\n` escapes decoded, nothing else changed, no newline added).
* The name `f` is not needed, and no cookie or session was used.

Layout of the text:

* LF line endings. No trailing newline after the last line. Not a download, so no BOM.
* No `Deck` header and no `Sideboard` header. The sideboard is separated from the main deck by exactly one empty line (`\n\n`).
* Card line: `<count> <name> (<SET>) <collector number>`. Real set codes in uppercase (`MH3`, `SPG`, `TLE`, `TLA`, `WOT`, `ZNR`, `PIO`). The printing is a recent one the site chose for Arena (for example `Lightning Bolt (TLE) 32`, `Arid Mesa (SPG) 109`), not the printing in the tournament deck. A collector number can be `0` (`Consign to Memory (SPG) 0` in 910594).
* Split card: `Wear // Tear (PIO) 398`.
* Double-faced card: front face only, `Sink into Stupor (MH3) 241`.
* Cards not on Arena are dropped (for example `Obsidian Charmaw`, `Shardless Agent`, `Murktide Regent`). Quirk: the dropped card's count is glued in front of the next kept line's count, giving wrong counts: `44 Subtlety (SPG) 45` (should be 4), `33 Striped Riverwinder`, `32 Dismember`, `23 Quantum Riddler`, `32 Clarion Conqueror`. This is a site bug, not a layout rule. Do not copy it and do not parse it.
* Localized variants (`FR`, `DE`, ...) hold localized names in raw ISO-8859-1 bytes.

```
4 Seasoned Pyromancer (MH1) 145\n
...
1 Sunbaked Canyon (TLE) 58\n
\n
1 Blood Moon (WOT) 40\n
...
2 Wear // Tear (PIO) 398\n
```

## Differences from the design

Item 36 exporters:

| # | Item 36 says | mtgtop8 does |
|---|---|---|
| 1 | MTGO: one empty line, then the sideboard | `Sideboard` line, no empty line |
| 2 | MTGO: split as `A // B` (common rule) | `A/B` |
| 3 | `.dec`: `// <deck name>` as the header | `// Deck file created with mtgtop8.com`, then `// NAME :`, `// CREATOR :`, `// FORMAT :` lines |
| 4 | `.dec`: `N Name` lines | `N [SET] Name` (the brackets are always present, set code often empty) |
| 5 | `.dec`: `SB: N Name` | `SB:  N [SET] Name` (two spaces) |
| 6 | `.dec`: split as `A // B` | `A / B` |
| 7 | MTGA: `Deck` first line | no `Deck` line |
| 8 | MTGA: `Sideboard` header after an empty line | an empty line only |
| 9 | MTGA: LF (final newline not specified) | LF, no final newline |
| 10 | MTGA: `W-MTGA-UNAVAILABLE` warning for cards not on Arena (card stays in the text) | mtgtop8 silently drops the card (and corrupts the next count) |
| 11 | CRLF for MTGO and `.dec` | matches, and the last line also ends with CRLF |
| 12 | Double-faced by front-face name | matches in all three |

Item 16 parser, reading mtgtop8 exports:

| # | Input | Result with the current grammar |
|---|---|---|
| a | MTGO: `Sideboard` header, `Wear/Tear` | parses (`Sideboard` is a header, `Fire/Ice` accepted) |
| b | MTGA: no headers, blank-line sideboard, `Wear // Tear (PIO) 398`, collector number `0` | parses (blank-line rule; number is alphanumeric) |
| c | `.dec`: `// Deck file ...`, `// NAME : ...` | parses (comments begin `//`) |
| d | `.dec`: `4 [] Endurance`, `4 [M11] Lightning Bolt` | FAILS: the name would be `[] Endurance`, which resolves to no card (`E-RESOLVE-UNKNOWN` or similar), or `[M11] Lightning Bolt` |
| e | `.dec`: `SB:  1 [9E] Blood Moon` | uncertain: `SB: <card line>` does not say whether extra whitespace after `SB:` is allowed |
| f | `.dec`: `Wear / Tear` | FAILS: only `Fire/Ice` and `Fire  //  Ice` are accepted |
| g | A `.dec` or MTGO sideboard card that is also in the main deck | parses (counts add up in the validator) |
| h | Item 16 treats a first-line `//` as a comment, but `Deck` file has `// NAME : x` | no problem |

## Proposed changes

### Item 36 (exporters)

* **MTGO:** `N Name` lines, then the line `Sideboard`, then the sideboard lines. No empty line. No set codes. CRLF after every line, including the last. Omit the `Sideboard` line when the sideboard is empty (not seen on mtgtop8, a decision for us).
* **`.dec`:**
  * First line `// Deck file created with tcg-gauntlet` (mtgtop8 writes its own name, and the check against samples must skip this line).
  * Then `// NAME : <deck name>`, optionally `// CREATOR : <author>` and `// FORMAT : <format name>` when known.
  * Card lines `N [SET] Name`. Always write the brackets. Write `[]` when no set is known. Magic Workstation set codes differ from MTGJSON codes (`9E` against `9ED`), and we have no mapping, so v1 writes `[]` always. Say so in the rule.
  * Sideboard lines `SB:  N [SET] Name` with two spaces after `SB:`.
  * CRLF after every line, including the last.
* **MTGA:** no `Deck` line. `N Name (SET) num` lines, one empty line, sideboard lines in the same form. LF, and no newline after the last line. If the sideboard is empty, write no empty line.
  * Keep `W-MTGA-UNAVAILABLE`, but keep the card in the text (a warning is better than mtgtop8's silent drop, which corrupts counts).
  * Printing: use the deck's resolved printing, and the default printing from the Technical Plan when none is given. mtgtop8 substitutes a recent Arena printing. Do not copy that. Exact-printing behaviour is a design decision, not a layout fact.
* **Common rule (replaces the current one):** split cards are written `A // B` in MTGA, `A/B` in MTGO and `A / B` in `.dec`. Double-faced and adventure cards are written by front-face name (adventures: not seen in the samples, rule kept).
* Add to item 36: the sample files are a layout reference only. A conformance case for each deck is made in item 41 with fixture cards, and the comparison skips the `.dec` first comment line and any `SET` that the fixtures do not have.

### Item 16 (deck-file grammar)

* **Card line grammar:** add an optional bracketed set code between the count and the name: `count [SET] name`, where `SET` is 0 to 6 alphanumeric characters (`[]` is empty). Case-insensitive. Magic Workstation codes may not exist as MTGJSON codes, so treat a `[SET]` that matches no known set as a hint that is ignored without an error; do not use it to pick a printing unless it matches a set code that has the named card. When both `[SET]` and a trailing `(SET) num` appear, give `E-PARSE-LINE`.
* **`SB:` lines:** allow one or more spaces or tabs between `SB:` and the card line. Matched case-insensitively.
* **Name matching:** the accepted split-card spellings become: `Fire // Ice` (canonical), `Fire/Ice`, `Fire / Ice`, and the same with extra spaces. The rule is that a run of whitespace around one or two slashes is accepted, after normalisation of the Technical Plan.
* **Comments:** state that `// KEY : value` lines in `.dec` files are plain comments and are not read.
* **Examples:** add a `.dec` example with `[SET]` and `SB:  N` lines, and an MTGO example with the `Sideboard` header. Say that an MTGO list with a `Sideboard` header and an MTGO list with a blank line both parse.
* **Collector number:** state that `0` is a valid number.
* Header matching: the `Sideboard` header with CRLF already works. Keep.

## Open issues

* MTGO and Cockatrice import: UNVERIFIED (I could not run either).
  * MTGO: the MTGO layout (count + name, a `Sideboard` line, CRLF, `Wear/Tear`) is the layout mtgtop8 offers for MTGO's deck import, and `Sink into Stupor` front-face names match MTGO naming. Plausible. MTGO's own export uses a blank line, which is why our parser accepts both.
  * Cockatrice: it reads `N Name` lines with a `Sideboard` line or a blank-line sideboard, and `SB: N Name` in its text import. A `.dec` file with `[SET]` brackets might not import cleanly (Cockatrice is not Magic Workstation), so `[]` everywhere is the safer choice. Plausible, not verified. Split cards in Cockatrice use `Fire // Ice`, and `A / B` is likely not matched. Check before shipping `.dec`.
  * Arena: the blank-line sideboard without a `Sideboard` header is the layout mtgtop8 gives for Arena's import. Arena's own export uses `Deck`, `Sideboard` and `Commander` headers. Plausible, unverified.
* Non-ASCII card names in MTGO and `.dec` were not sampled (no accented card was found in 3 Modern and 1 Legacy decks scanned). Likely raw ISO-8859-1 bytes. If so, our exporters (UTF-8 per item 16) differ, and the parser would need to accept or reject Latin-1. Needs one more sample, for example a deck with `Lim-Dul`-style names or `Jötun Grunt`.
* Adventure cards and cards with three or more names (`Who // What // When // Where // Why`) are not sampled.
* The `.dec` set-code mapping (Magic Workstation codes) is undocumented. Using `[]` always avoids it.
* How mtgtop8 orders cards is only partly clear (the page display order). We do not need to match it, because conformance cases compare cards as a set. If exact order matters, item 36 should state our own order (for example `group-by-type`).
* mtgtop8's `.dec` header lines `NAME`/`CREATOR`/`FORMAT` depend on the `f` value. The mapping from the `f` value to these fields (`Modern_Living_End_by_Jonasfischer` becomes name `Living End`, creator `Jonasfischer`, format `Modern`) was observed once.
* mtgtop8 may change these layouts without notice, and its terms of use for automated fetching were not checked. The samples are small, for layout reference only.
