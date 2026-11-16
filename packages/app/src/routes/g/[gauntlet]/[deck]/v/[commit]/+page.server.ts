import { error } from "@sveltejs/kit";
import { diffDecks } from "@tcg-gauntlet/engine";
import type { DiffEntry } from "@tcg-gauntlet/engine";
import { requireDeck } from "#lib/server/app-state";
import { getConfig } from "#lib/server/config";
import { githubLinks } from "#lib/server/github-links";
import { renderMarkdown } from "#lib/server/markdown";
import { resolveOldVersion } from "#lib/server/snapshot";
import { getHistory } from "#lib/server/sync";
import { groupsOf, violationViews } from "#lib/server/views";
import type { PageServerLoad } from "./$types";

/** A full SHA or a short one of 7 or more characters. Null when there is no unique match. */
function pick<T extends { commitSha: string }>(rows: T[], q: string): T | null {
  if (!/^[0-9a-f]{7,64}$/i.test(q)) return null;
  const hits = rows.filter((v) => v.commitSha.startsWith(q.toLowerCase()));
  return hits.length === 1 ? (hits[0] as T) : null;
}

export const load: PageServerLoad = async ({ params, url }) => {
  const { snap, g, d } = requireDeck(params.gauntlet, params.deck);
  const history = getHistory();
  if (history === null) error(503, "Preparing data");
  const all = history.versions(d.currentPath, Number.MAX_SAFE_INTEGER);
  const v = pick(all, params.commit);
  if (v === null) error(404, "Version not found");

  const base = `/g/${encodeURIComponent(g.folder)}/${encodeURIComponent(d.name)}`;
  const text = v.txtBlob === null ? null : await history.content(v.txtBlob);
  const groups =
    text?.parsed != null
      ? groupsOf(resolveOldVersion(snap, d, text.parsed))
      : null;
  const primer =
    v.mdBlob === null ? null : renderMarkdown(await history.rawText(v.mdBlob));

  let diff: {
    from: string;
    entries: DiffEntry[];
    unavailable: boolean;
  } | null = null;
  const cmp = url.searchParams.get("compare");
  if (cmp !== null) {
    const other = pick(all, cmp);
    if (other === null) error(404, "Version to compare with not found");
    const otherText =
      other.txtBlob === null ? null : await history.content(other.txtBlob);
    const ok = text?.parsed != null && otherText?.parsed != null;
    diff = {
      from: other.commitSha,
      unavailable: !ok,
      entries: ok
        ? diffDecks(otherText.parsed as never, text.parsed as never)
        : [],
    };
  }

  return {
    gauntlet: { folder: g.folder, name: g.name },
    name: d.name,
    displayName: d.displayName,
    base,
    version: {
      commit: v.commitSha,
      commitUrl: githubLinks(getConfig()).commit(v.commitSha),
      author: v.authorName,
      date: v.authorDate,
      subject: v.subject,
      status: v.status,
    },
    // Old versions are resolved against the current card data.
    groups,
    raw: groups === null ? (text?.text ?? "") : null,
    notice:
      text !== null && text.parsed === null
        ? "This version no longer parses under the current schema. It is shown as raw text."
        : null,
    violations: violationViews([]),
    primerHtml: primer,
    diff,
  };
};
