import type {
  CardLookup,
  ExportResult,
  ResolvedDeck,
  Violation,
} from "../types.js";
import { sortViolations, violation } from "../util.js";
import { type ExportLine, exportSections } from "./common.js";

/**
 * MTG Arena text: `N Name (SET) num` lines, one empty line, then the sideboard in
 * the same form. No headers. LF, and no newline after the last line. A line
 * without a set code uses the card's Arena printing, if it has one, and else the
 * resolved printing. A line with a set code keeps its printing. A card with no
 * printing is written without a set code. A printing that is not on Arena stays
 * in the text and adds W-MTGA-UNAVAILABLE.
 */
export function exportMtga(
  deck: ResolvedDeck,
  lookup: CardLookup,
): ExportResult {
  const { main, sideboard } = exportSections(deck, "mtga", true, (e) =>
    e.explicitPrinting || e.card === null
      ? e.printing
      : (lookup.arenaPrinting(e.card) ?? e.printing),
  );
  const warnings: Violation[] = [];
  const text = (l: ExportLine): string => {
    const p = l.printing;
    if (p !== null && !p.availability.includes("arena")) {
      warnings.push(
        violation(
          "W-MTGA-UNAVAILABLE",
          deck.parsed.path,
          `"${l.name}" is not available on MTG Arena`,
          l.entry.line.line,
        ),
      );
    }
    return l.set === null
      ? `${l.count} ${l.name}`
      : `${l.count} ${l.name} (${l.set}) ${l.number ?? ""}`.trimEnd();
  };
  const mainText = main.map(text);
  const sideText = sideboard.map(text);
  const text2 =
    sideText.length > 0
      ? [...mainText, "", ...sideText].join("\n")
      : mainText.join("\n");
  return { text: text2, warnings: sortViolations(warnings) };
}
