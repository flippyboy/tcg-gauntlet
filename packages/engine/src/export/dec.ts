import type { ExportOptions, ExportResult, ResolvedDeck } from "../types.js";
import { exportSections } from "./common.js";

const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ").trim();

function deckName(deck: ResolvedDeck): string {
  const fm = deck.parsed.frontMatter.name;
  if (fm !== undefined && fm !== "") return fm;
  const base = deck.parsed.path.split("/").pop() ?? deck.parsed.path;
  return base.replace(/\.txt$/i, "");
}

/**
 * Magic Workstation `.dec` text, as mtgtop8 serves it. Card lines are
 * `N [] Name`: the brackets are always written and always empty, because Magic
 * Workstation set codes differ from MTGJSON's and there is no mapping. Sideboard
 * lines are `SB:  N [] Name` (two spaces). CRLF after every line.
 */
export function exportDec(
  deck: ResolvedDeck,
  opts: ExportOptions = {},
): ExportResult {
  const { main, sideboard } = exportSections(deck, "dec", false);
  const out = [
    "// Deck file created with tcg-gauntlet",
    `// NAME : ${oneLine(deckName(deck))}`,
  ];
  const author = deck.parsed.frontMatter.author;
  if (author !== undefined && author !== "")
    out.push(`// CREATOR : ${oneLine(author)}`);
  if (opts.formatName !== undefined && opts.formatName !== "") {
    out.push(`// FORMAT : ${oneLine(opts.formatName)}`);
  }
  out.push(...main.map((l) => `${l.count} [] ${l.name}`));
  out.push(...sideboard.map((l) => `SB:  ${l.count} [] ${l.name}`));
  return { text: out.map((l) => `${l}\r\n`).join(""), warnings: [] };
}
