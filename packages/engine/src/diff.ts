import { normalizeName } from "./normalize-name.js";
import type { DiffEntry, ParsedDeck, Section } from "./types.js";
import { compareCodePoints } from "./util.js";

const SECTION_ORDER: Section[] = ["main", "sideboard", "commander"];
const KIND_ORDER: DiffEntry["kind"][] = [
  "removed",
  "added",
  "count",
  "printing",
];

interface Side {
  name: string;
  count: number;
  /** Printings as written (`SET number`), for lines that give a set code. */
  printings: Set<string>;
}

function collect(deck: ParsedDeck): Map<string, Side> {
  const map = new Map<string, Side>();
  for (const l of deck.lines) {
    const key = `${l.section}\u0000${normalizeName(l.rawName)}`;
    const s = map.get(key) ?? {
      name: l.rawName,
      count: 0,
      printings: new Set<string>(),
    };
    s.count += l.count;
    if (l.set !== undefined)
      s.printings.add(l.number === undefined ? l.set : `${l.set} ${l.number}`);
    map.set(key, s);
  }
  return map;
}

const printingText = (s: Side): string =>
  [...s.printings].sort(compareCodePoints).join(", ");

/**
 * Compares two parsed decks by (section, normalised name). Counts are summed over
 * lines. A `printing` entry is reported only when both sides give a set code for
 * the card and the printings differ.
 */
export function diffDecks(a: ParsedDeck, b: ParsedDeck): DiffEntry[] {
  const ma = collect(a);
  const mb = collect(b);
  const out: DiffEntry[] = [];
  const sectionOf = (key: string): Section => key.split("\u0000")[0] as Section;
  for (const [key, sa] of ma) {
    const section = sectionOf(key);
    const sb = mb.get(key);
    if (sb === undefined) {
      out.push({ kind: "removed", section, name: sa.name, from: sa.count });
      continue;
    }
    if (sa.count !== sb.count) {
      out.push({
        kind: "count",
        section,
        name: sb.name,
        from: sa.count,
        to: sb.count,
      });
    }
    if (sa.printings.size > 0 && sb.printings.size > 0) {
      const from = printingText(sa);
      const to = printingText(sb);
      if (from !== to)
        out.push({ kind: "printing", section, name: sb.name, from, to });
    }
  }
  for (const [key, sb] of mb) {
    if (!ma.has(key)) {
      out.push({
        kind: "added",
        section: sectionOf(key),
        name: sb.name,
        to: sb.count,
      });
    }
  }
  return out.sort(
    (x, y) =>
      SECTION_ORDER.indexOf(x.section) - SECTION_ORDER.indexOf(y.section) ||
      KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) ||
      compareCodePoints(normalizeName(x.name), normalizeName(y.name)) ||
      compareCodePoints(x.name, y.name),
  );
}
