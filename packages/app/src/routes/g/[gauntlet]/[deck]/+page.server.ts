import { requireDeck } from "#lib/server/app-state";
import { getConfig } from "#lib/server/config";
import { githubLinks } from "#lib/server/github-links";
import { viewOfGroups, violationViews } from "#lib/server/views";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { snap, g, d } = requireDeck(params.gauntlet, params.deck);
  const links = githubLinks(getConfig());
  const base = `/g/${encodeURIComponent(g.folder)}/${encodeURIComponent(d.name)}`;
  const fm = d.parsed.frontMatter;
  return {
    gauntlet: { folder: g.folder, name: g.name },
    name: d.name,
    displayName: d.displayName,
    meta: {
      author: fm.author ?? null,
      archetype: fm.archetype ?? null,
      description: fm.description ?? null,
      tags: fm.tags ?? [],
      source: fm.source ?? null,
      lastUpdated: d.lastUpdated?.authorDate ?? null,
    },
    formatName: g.formatName,
    legality: {
      valid: d.valid,
      errorCount: d.errorCount,
      warningCount: d.warningCount,
      mtgjsonVersion: snap.mtgjson.version,
      mtgjsonDate: snap.mtgjson.date,
      violations: violationViews(d.violations),
    },
    groups: viewOfGroups(d.grouping),
    mainCount: d.mainCount,
    sideboardCount: d.sideboardCount,
    primerHtml: d.primerHtml,
    links: {
      base,
      mtgo: `${base}/export/mtgo`,
      dec: `${base}/export/dec`,
      mtga: `${base}/export/mtga`,
      proxies: `${base}/proxies`,
      history: `${base}/history`,
      edit: links.edit(d.path),
      editPrimer: links.edit(d.primerPath ?? `${g.folder}/${d.name}.md`),
    },
  };
};
