import { requireSnapshot } from "#lib/server/app-state";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  const snap = requireSnapshot();
  return {
    gauntlets: snap.gauntlets.map((g) => ({
      folder: g.folder,
      name: g.name,
      formatName: g.formatName,
      deckCount: g.deckCount,
      invalidCount: g.invalidCount,
      errorCount: g.errors.filter((e) => e.severity === "error").length,
    })),
  };
};
