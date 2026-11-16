import type { ExportResult, ResolvedDeck } from "../types.js";
import { exportSections } from "./common.js";

/**
 * MTGO text: `N Name` lines, a `Sideboard` line, then the sideboard. No blank
 * line, no set codes, CRLF after every line including the last.
 */
export function exportMtgo(deck: ResolvedDeck): ExportResult {
  const { main, sideboard } = exportSections(deck, "mtgo", false);
  const out = main.map((l) => `${l.count} ${l.name}`);
  if (sideboard.length > 0) {
    out.push("Sideboard", ...sideboard.map((l) => `${l.count} ${l.name}`));
  }
  return { text: out.map((l) => `${l}\r\n`).join(""), warnings: [] };
}
