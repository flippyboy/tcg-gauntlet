// View models: plain data the pages receive (never the engine's full objects).
import type { ResolvedDeck, TypeGroup, Violation } from "@tcg-gauntlet/engine";
import { groupByType } from "@tcg-gauntlet/engine";
import type { CardRow, GroupView, ViolationView } from "../view-types.js";

export type { CardRow, GroupView, ViolationView };

const IMG = "https://cards.scryfall.io";

export const scryfallUrl = (size: "small" | "normal", id: string): string =>
  `${IMG}/${size}/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`;

function groupView(g: TypeGroup): GroupView {
  return {
    name: g.name,
    count: g.entries.reduce((n, e) => n + e.count, 0),
    cards: g.entries.map((e) => {
      const id = e.printing?.scryfallId ?? null;
      return {
        count: e.count,
        name: e.card?.name ?? e.line.rawName,
        set: e.printing?.set ?? null,
        number: e.printing?.number ?? null,
        small: id === null ? null : scryfallUrl("small", id),
        normal: id === null ? null : scryfallUrl("normal", id),
        known: e.card !== null,
      };
    }),
  };
}

export function groupsOf(deck: ResolvedDeck): {
  main: GroupView[];
  sideboard: GroupView[];
} {
  const g = groupByType(deck.entries);
  return { main: g.main.map(groupView), sideboard: g.sideboard.map(groupView) };
}

export const viewOfGroups = (g: {
  main: TypeGroup[];
  sideboard: TypeGroup[];
}): {
  main: GroupView[];
  sideboard: GroupView[];
} => ({ main: g.main.map(groupView), sideboard: g.sideboard.map(groupView) });

export const violationViews = (vs: readonly Violation[]): ViolationView[] =>
  vs.map((v) => ({
    code: v.code,
    severity: v.severity,
    line: v.line ?? null,
    message: v.message,
    suggestion: v.suggestion ?? null,
  }));

/** `filename*=UTF-8''...` per RFC 6266 and RFC 5987. */
export function contentDisposition(filename: string): string {
  const enc = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${enc}`;
}

/** A file name without path separators or control characters. */
export const safeFileName = (name: string): string =>
  // eslint-disable-next-line no-control-regex
  name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "deck";
