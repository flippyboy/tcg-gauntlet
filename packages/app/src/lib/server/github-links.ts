// Links to the deck repo on GitHub. In test mode the configured URL is the base.
import type { Config } from "./config.js";

const encodePath = (p: string): string =>
  p
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");

export interface GithubLinks {
  edit(path: string): string;
  newFile(folder: string): string;
  commit(sha: string): string;
  blob(path: string): string;
}

export function githubLinks(
  config: Pick<Config, "repoWebUrl" | "branch">,
): GithubLinks {
  const base = config.repoWebUrl;
  const branch = encodePath(config.branch);
  return {
    edit: (path) => `${base}/edit/${branch}/${encodePath(path)}`,
    newFile: (folder) => `${base}/new/${branch}/${encodePath(folder)}`,
    commit: (sha) => `${base}/commit/${encodeURIComponent(sha)}`,
    blob: (path) => `${base}/blob/${branch}/${encodePath(path)}`,
  };
}
