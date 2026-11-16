import type { ResolvedEntry } from "./types.js";
import { compareCodePoints } from "./util.js";

export const TYPE_GROUPS = [
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
  "Other",
] as const;

export type TypeGroupName = (typeof TYPE_GROUPS)[number];

export interface TypeGroup {
  name: TypeGroupName | "Sideboard";
  entries: ResolvedEntry[];
}

/** The group of a card: the first listed type it has, except that any Land is Land. */
export function groupOf(entry: ResolvedEntry): TypeGroupName {
  const types = entry.card?.types ?? [];
  if (types.includes("Land")) return "Land";
  for (const g of TYPE_GROUPS) {
    if (g !== "Other" && types.includes(g)) return g;
  }
  return "Other";
}

function byManaValueThenName(a: ResolvedEntry, b: ResolvedEntry): number {
  const mv = (a.card?.manaValue ?? 0) - (b.card?.manaValue ?? 0);
  if (mv !== 0) return mv;
  return compareCodePoints(
    a.card?.name ?? a.line.rawName,
    b.card?.name ?? b.line.rawName,
  );
}

/**
 * Groups a deck for display and export. Main deck groups come in the order of
 * `TYPE_GROUPS`, empty groups left out. The sideboard is a single group. Within a
 * group, cards are ordered by mana value, then name. Commander cards are not
 * shown. The input order breaks ties, so the result is stable.
 */
export function groupByType(entries: readonly ResolvedEntry[]): {
  main: TypeGroup[];
  sideboard: TypeGroup[];
} {
  const main: TypeGroup[] = [];
  for (const name of TYPE_GROUPS) {
    const es = entries
      .filter((e) => e.section === "main" && groupOf(e) === name)
      .sort(byManaValueThenName);
    if (es.length > 0) main.push({ name, entries: es });
  }
  const side = entries
    .filter((e) => e.section === "sideboard")
    .sort(byManaValueThenName);
  return {
    main,
    sideboard: side.length > 0 ? [{ name: "Sideboard", entries: side }] : [],
  };
}
