import { error } from "@sveltejs/kit";
import { requireDeck } from "#lib/server/app-state";
import { getConfig } from "#lib/server/config";
import { githubLinks } from "#lib/server/github-links";
import { getHistory } from "#lib/server/sync";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { g, d } = requireDeck(params.gauntlet, params.deck);
  const history = getHistory();
  if (history === null) error(503, "Preparing data");
  const config = getConfig();
  const links = githubLinks(config);
  const base = `/g/${encodeURIComponent(g.folder)}/${encodeURIComponent(d.name)}`;
  return {
    gauntlet: { folder: g.folder, name: g.name },
    name: d.name,
    displayName: d.displayName,
    base,
    limit: config.historyMaxVersions,
    versions: history
      .versions(d.currentPath, config.historyMaxVersions)
      .map((v) => ({
        seq: v.seq,
        commit: v.commitSha,
        short: v.commitSha.slice(0, 7),
        commitUrl: links.commit(v.commitSha),
        author: v.authorName,
        date: v.authorDate,
        subject: v.subject,
        status: v.status,
        changed: v.changed,
      })),
  };
};
