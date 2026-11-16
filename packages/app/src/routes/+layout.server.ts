import { ENGINE_VERSION } from "@tcg-gauntlet/engine";
import { requireSnapshot } from "#lib/server/app-state";
import { getConfig } from "#lib/server/config";
import { githubLinks } from "#lib/server/github-links";
import { getStatusState, isStale } from "#lib/server/status";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = () => {
  const snap = requireSnapshot();
  const st = getStatusState();
  const config = getConfig();
  return {
    footer: {
      commit: snap.commit,
      commitUrl: githubLinks(config).commit(snap.commit),
      lastSync: st.lastSync.finished,
      lastSyncError: st.lastSync.error,
      mtgjsonVersion: snap.mtgjson.version,
      mtgjsonDate: snap.mtgjson.date,
      engineVersion: ENGINE_VERSION,
    },
    staleSince: isStale() ? st.staleSince : null,
  };
};
