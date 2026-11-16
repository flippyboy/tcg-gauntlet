import {
  compareCodePoints,
  parseFormatRef,
  parseGauntlet,
} from "@tcg-gauntlet/engine";
import type { Change, GauntletContents, RepoContents } from "./types.js";

/**
 * The decks that a set of changes affects, as repo paths in byte order. Only
 * decks that exist in `contents` are returned. A `D` change of a deck file or
 * gauntlet file selects nothing, because nothing is left to check. A `D`
 * change of a format file selects every deck whose gauntlet still refers to
 * it, so CI reports `E-FORMAT-UNKNOWN` instead of letting the delete through.
 */
export function affectedDecks(
  changes: readonly Change[],
  contents: RepoContents,
): string[] {
  const out = new Set<string>();
  const byFolder = new Map<string, GauntletContents>();
  for (const g of contents.gauntlets) byFolder.set(g.folder, g);
  const addAll = (g: GauntletContents): void => {
    for (const d of g.decks) out.add(d.path);
  };

  for (const c of changes) {
    const parts = c.path.split("/");
    if (parts.length !== 2) continue;
    const [top, file] = parts as [string, string];
    if (top !== "formats" && c.status === "D") continue;
    if (top === "formats") {
      if (!file.endsWith(".yaml")) continue;
      for (const g of contents.gauntlets) {
        const def = parseGauntlet(g.yamlText).def;
        const ref = def === null ? null : parseFormatRef(def.format);
        if (ref?.kind === "repo" && ref.path === c.path) addAll(g);
      }
      continue;
    }
    const g = byFolder.get(top);
    if (g === undefined) continue;
    if (file === "gauntlet.yaml" || file === "gauntlet.md") {
      addAll(g);
    } else if (file.endsWith(".txt") || file.endsWith(".md")) {
      const txt = `${top}/${file.slice(0, file.lastIndexOf("."))}.txt`;
      if (g.decks.some((d) => d.path === txt)) out.add(txt);
    }
  }
  return [...out].sort(compareCodePoints);
}
