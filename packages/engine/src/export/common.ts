import { groupByType } from "../group-by-type.js";
import type {
  CardRef,
  PrintingRef,
  ResolvedDeck,
  ResolvedEntry,
} from "../types.js";

/** Layouts whose faces are halves of one card (written with both names). */
const SPLIT_LAYOUTS = new Set(["split", "aftermath"]);

export type NameStyle = "mtgo" | "dec" | "mtga";

/**
 * The name of a card as a format writes it. Split cards: `A // B` in MTGA, `A/B`
 * in MTGO and `A / B` in `.dec`. Double-faced and adventure cards: front face only.
 */
export function exportName(
  card: CardRef | null,
  rawName: string,
  style: NameStyle,
): string {
  if (card === null) return rawName;
  if (SPLIT_LAYOUTS.has(card.layout) && card.faces.length > 1) {
    const sep = style === "mtga" ? " // " : style === "mtgo" ? "/" : " / ";
    const names = card.name.split(" // ");
    return names.join(sep);
  }
  const front = card.faces[0];
  if (card.faces.length > 1 && front !== undefined) return front.name;
  return card.name;
}

export interface ExportLine {
  count: number;
  name: string;
  /** The entry that stands for the merged lines (the first one). */
  entry: ResolvedEntry;
  /** The printing the line is written with. */
  printing: PrintingRef | null;
  set: string | null;
  number: string | null;
}

/**
 * The lines of one section in export order (group-by-type). Lines of the same card
 * are merged, and with `byPrinting` only when they also have the same printing.
 */
function lines(
  entries: ResolvedEntry[],
  style: NameStyle,
  byPrinting: boolean,
  printingOf: PrintingOf,
): ExportLine[] {
  const merged = new Map<string, ExportLine>();
  for (const e of entries) {
    const name = exportName(e.card, e.line.rawName, style);
    const p = printingOf(e);
    const key = byPrinting
      ? `${name}\u0000${p?.set ?? ""}\u0000${p?.number ?? ""}`
      : name;
    const m = merged.get(key);
    if (m) m.count += e.count;
    else {
      merged.set(key, {
        count: e.count,
        name,
        entry: e,
        printing: p,
        set: p?.set ?? null,
        number: p?.number ?? null,
      });
    }
  }
  return [...merged.values()];
}

export type PrintingOf = (e: ResolvedEntry) => PrintingRef | null;

/**
 * `printingOf` picks the printing a line is written with. It defaults to the
 * resolved printing.
 */
export function exportSections(
  deck: ResolvedDeck,
  style: NameStyle,
  byPrinting: boolean,
  printingOf: PrintingOf = (e) => e.printing,
): { main: ExportLine[]; sideboard: ExportLine[] } {
  const g = groupByType(deck.entries);
  const flat = (groups: { entries: ResolvedEntry[] }[]): ExportLine[] =>
    lines(
      groups.flatMap((x) => x.entries),
      style,
      byPrinting,
      printingOf,
    );
  return { main: flat(g.main), sideboard: flat(g.sideboard) };
}
