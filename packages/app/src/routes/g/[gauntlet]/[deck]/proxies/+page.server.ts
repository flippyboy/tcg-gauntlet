import { requireDeck } from "#lib/server/app-state";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { g, d } = requireDeck(params.gauntlet, params.deck);
  return {
    gauntlet: { folder: g.folder, name: g.name },
    name: d.name,
    displayName: d.displayName,
    base: `/g/${encodeURIComponent(g.folder)}/${encodeURIComponent(d.name)}`,
    // The cards the PDF builder prints: one per distinct printing, with its count.
    cards: d.proxyCards.flatMap((c) =>
      c.scryfallId === null ? [] : [{ ...c, scryfallId: c.scryfallId }],
    ),
  };
};
