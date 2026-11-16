import { requireDeck } from "#lib/server/app-state";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { g, d } = requireDeck(params.gauntlet, params.deck);
  return {
    gauntlet: { folder: g.folder, name: g.name },
    name: d.name,
    displayName: d.displayName,
    base: `/g/${encodeURIComponent(g.folder)}/${encodeURIComponent(d.name)}`,
    text: d.exports.mtga,
    unavailable: d.exports.mtgaUnavailable,
  };
};
