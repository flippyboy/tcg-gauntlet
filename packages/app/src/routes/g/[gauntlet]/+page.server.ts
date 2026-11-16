import { error } from "@sveltejs/kit";
import { requireSnapshot } from "#lib/server/app-state";
import { getConfig } from "#lib/server/config";
import { githubLinks } from "#lib/server/github-links";
import { findGauntlet } from "#lib/server/snapshot";
import { violationViews } from "#lib/server/views";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const snap = requireSnapshot();
  const g = findGauntlet(snap, params.gauntlet);
  if (g === undefined) error(404, "Gauntlet not found");
  return {
    folder: g.folder,
    name: g.name,
    formatName: g.formatName,
    descriptionHtml: g.descriptionHtml,
    errors: violationViews(g.errors),
    deckCount: g.deckCount,
    newDeckUrl: githubLinks(getConfig()).newFile(g.folder),
    decks: g.decks.map((d) => ({
      name: d.name,
      displayName: d.displayName,
      archetype: d.parsed.frontMatter.archetype ?? null,
      tags: d.parsed.frontMatter.tags ?? [],
      valid: d.valid,
      errorCount: d.errorCount,
      warningCount: d.warningCount,
      mainCount: d.mainCount,
      sideboardCount: d.sideboardCount,
    })),
  };
};
