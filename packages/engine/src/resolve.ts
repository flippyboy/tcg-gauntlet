import type {
  CardLookup,
  FormatKey,
  ParsedDeck,
  PrintingRef,
  ResolvedDeck,
  ResolvedEntry,
  Violation,
} from "./types.js";
import { violation } from "./util.js";

/**
 * Turns each deck line into a card plus a printing (spec/deck-file.md, "Printings").
 * Unknown cards and unknown printings are reported, and resolution goes on.
 */
export function resolveDeck(
  parsed: ParsedDeck,
  formatKey: FormatKey,
  lookup: CardLookup,
): ResolvedDeck {
  const violations: Violation[] = [];
  const entries: ResolvedEntry[] = [];
  for (const line of parsed.lines) {
    const card = lookup.findCard(line.rawName);
    if (card === null) {
      const near = lookup.suggest(line.rawName, 3).slice(0, 3);
      const message =
        near.length > 0
          ? `Card "${line.rawName}" was not found. Close names: ${near.join("; ")}`
          : `Card "${line.rawName}" was not found`;
      violations.push(
        violation(
          "E-CARD-UNKNOWN",
          parsed.path,
          message,
          line.line,
          near.length > 0 ? `Did you mean "${near[0]}"?` : undefined,
        ),
      );
      entries.push({
        line,
        count: line.count,
        section: line.section,
        card: null,
        printing: null,
        explicitPrinting: false,
      });
      continue;
    }

    let printing: PrintingRef | null = null;
    let explicit = false;
    if (line.set !== undefined) {
      printing = lookup.findPrinting(line.set, line.number, card.name);
      if (printing === null) {
        const what =
          line.number === undefined ? line.set : `${line.set} ${line.number}`;
        violations.push(
          violation(
            "E-PRINTING-UNKNOWN",
            parsed.path,
            `"${card.name}" has no printing "${what}"`,
            line.line,
            "Remove the set code to use the default printing",
          ),
        );
      } else {
        explicit = true;
      }
    } else if (line.hint !== undefined) {
      // A hint is used only when it is a set that has the card. Otherwise ignored.
      printing = lookup.findPrinting(line.hint, undefined, card.name);
      explicit = printing !== null;
    }
    if (printing === null) printing = lookup.defaultPrinting(formatKey, card);
    entries.push({
      line,
      count: line.count,
      section: line.section,
      card,
      printing,
      explicitPrinting: explicit,
    });
  }
  return { parsed, formatKey, entries, violations };
}
