# Conformance corpus

A folder of test decks with expected verdicts and expected exports. The engine, the card-data package, the validator and the app all run it, so they give the same answers. It is the executable form of the rules in [`spec/`](../spec/README.md).

- `cases/<name>/` is one case.
- `fixtures/cards.txt` lists every card name the cases use.
- `fixtures/mini-allprintings.sqlite` is a small MTGJSON `AllPrintings.sqlite` with the same tables and columns and only the rows of those cards and their sets. The SQLite card lookup runs against it.
- `fixtures/cards.json` has the same data for the in-memory lookup (`fakeLookup` in `packages/conformance`). The engine's own tests run against it.
- `layout-samples/mtgtop8/` holds the raw files that spike 3 downloaded from mtgtop8. They are a layout reference only. The three `mtgtop8-*` cases re-create them with fixture cards.

Everything here is byte-exact. Do not let an editor or formatter change line endings. Prettier and ESLint skip this folder.

## A case

```text
cases/legal-burn/
  deck.txt              the deck file, as bytes (line endings matter)
  case.json             what the checker must report
  expected.mtgo.txt     optional: the MTGO export, byte for byte
  expected.dec          optional: the .dec export, byte for byte
  expected.mtga.txt     optional: the MTGA export, byte for byte
```

`case.json`:

```json
{
  "description": "Free text for people.",
  "format": "preset:2015-modern@1",
  "expectedViolations": [{ "code": "E-LEGAL-BANNED", "line": 4 }],
  "expectedPrintings": { "4": "KTK/32" },
  "expectedMtgaWarnings": [{ "code": "W-MTGA-UNAVAILABLE", "line": 1 }]
}
```

- `format` is a format reference as in `gauntlet.yaml`. `preset:` references are read from `presets/`. `repo:` references are not supported in cases.
- `expectedViolations` lists every violation the deck gives, errors and warnings, with the line when the code has one. The runner compares them as a list in the order of `spec/error-codes.md`. A deck with no problem has an empty list.
- `expectedPrintings` (optional) maps a deck line to the printing it resolves to, as `SET/NUMBER`, or `none`. Only the lines listed are checked.
- `expectedMtgaWarnings` (optional) is the list of violations that the MTGA export returns. It is checked when `expected.mtga.txt` exists.
- The exports are compared as bytes, so CRLF, a final newline or its absence all count. The `.dec` export names the deck after the front matter `name`, or after the case folder (the file is treated as `<case>.txt`), and the format after its display name.

## Run it

```text
pnpm test
```

runs it against the in-memory lookup (`packages/engine/test/conformance.test.ts`). In code:

```ts
import { fakeLookup, runConformance } from "@tcg-gauntlet/conformance";

const mismatches = await runConformance(fakeLookup("conformance/fixtures/cards.json"), {
  casesDir: "conformance/cases",
  presetsDir: "presets",
});
```

`runConformance` takes any `CardLookup`. It returns a list of `{case, check, message}`, empty on success.

## Add a case

1. Make `cases/<name>/` with `deck.txt` and `case.json`. Use only cards in `fixtures/cards.txt`. If you need a new card, add its MTGJSON name to `cards.txt` (split and double-faced cards use the full name, such as `Wear // Tear`) and regenerate the fixtures.
2. Write `expectedViolations` by hand, from the spec, not from what the tool prints. A golden file that only copies the tool's output proves nothing.
3. Add `expected.*` files when the case is about an export. Check them against the layout rules in `spec/` and `docs/spikes/mtgtop8-exports.md` before you commit them.
4. Run `pnpm test`.

## Regenerate the fixtures

Needs Node 22.13 or newer (the built-in `node:sqlite` module; running a `.ts` file directly needs 22.18 or newer) and a real MTGJSON file:

```text
node scripts/build-fixtures.ts --mtgjson path/to/AllPrintings.sqlite
```

It reads `fixtures/cards.txt`, copies every printing of those cards, with their identifiers, legalities and sets, into `fixtures/mini-allprintings.sqlite`, and writes `fixtures/cards.json`. It fails if a name has no card. Commit both outputs. They change only when `cards.txt` or the MTGJSON file changes, so review such a diff: a different MTGJSON release can change legality or default printings, and the expectations in `case.json` may need a matching change.

## The cases

| Case                                                            | What it covers                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `legal-jund`, `legal-affinity`, `legal-burn`                    | Legal 2015 Modern decks, each in a different input layout, each with all three exports.                      |
| `banned-treasure-cruise`, `banned-cloudpost`                    | Cards on the banned list.                                                                                    |
| `legal-golgari-grave-troll`                                     | Legal in 2015 Modern, though banned in current Modern.                                                       |
| `not-in-pool-after-ori`                                         | A card first printed after Magic Origins.                                                                    |
| `size-61-main-16-side`, `size-59-main`                          | Deck size limits. There is no maximum main deck.                                                             |
| `copies-5-lightning-bolt`, `copies-any-number-text`             | Copies over main deck and sideboard; the basic land and any-number exemptions.                               |
| `split-and-dfc-names`, `split-dfc-exports`                      | Every spelling of split cards, double-faced and adventure cards by front face, and their exports.            |
| `unknown-card-typos`                                            | `E-CARD-UNKNOWN`, and a back-face name that is not accepted.                                                 |
| `basic-default-unh`                                             | Basic lands default to UNH; a set code is kept; Wastes and snow basics follow the normal rule; MTGA export.  |
| `printing-unknown`, `dec-hints`                                 | Explicit printings, wrong ones, `[SET]` hints.                                                               |
| `official-modern`, `official-vintage-restricted`                | Official formats: banned, not legal, restricted.                                                             |
| `commander-section`                                             | `E-DECK-SECTION`.                                                                                            |
| `parse-errors`                                                  | Lines that break the grammar.                                                                                |
| `front-matter-*`                                                | An unknown field (warning), a schema error, an unknown `schema_version`.                                     |
| `paste-arena`, `paste-mtgo`, `paste-moxfield`                   | Lists as pasted from Arena, MTGO and Moxfield.                                                               |
| `mtgtop8-mtgo`, `mtgtop8-dec`, `mtgtop8-mtga`                   | The three mtgtop8 layouts, re-created with fixture cards. Input and exports are in the layout of that site.  |
