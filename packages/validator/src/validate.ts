import { mkdirSync } from "node:fs";
import {
  ENGINE_VERSION,
  type FormatDef,
  type GauntletDef,
  type OfficialRules,
  type Violation,
  checkDeck,
  checkFormatDef,
  compareCodePoints,
  officialRules,
  parseDeck,
  parseFormatDef,
  parseGauntlet,
  sortViolations,
  violation,
} from "@tcg-gauntlet/engine";
import {
  type FormatBuild,
  type SqliteCardLookup,
  openCurrent,
  refreshCardData,
} from "@tcg-gauntlet/carddata";
import {
  type Change,
  type FormatResolution,
  type ResolvedFormat,
  type RepoContents,
  Git,
  affectedDecks,
  isFormatFailure,
  resolveFormat,
  scanRepo,
} from "@tcg-gauntlet/repo";
import type { FileResult, Report } from "./types.js";

export type Selection = { all: true } | { changedSince: string };

export interface ValidateOptions {
  /** The deck repo, absolute. */
  repoDir: string;
  dataDir: string;
  presetsDir: string;
  selection: Selection;
  /** `MTGJSON_BASE_URL`. */
  baseUrl: string;
  /** Self-check minimum of card names. Tests lower it for the mini fixture. */
  minCards?: number | undefined;
}

export type ValidateOutcome =
  | { kind: "report"; report: Report }
  /** Exit 2: no usable card data, or a usage error found late. */
  | { kind: "infrastructure"; message: string }
  /** Exit 2: the `--changed-since` ref does not resolve. */
  | { kind: "usage"; message: string };

interface GauntletState {
  folder: string;
  yamlPath: string;
  def: GauntletDef | null;
  violations: Violation[];
  /** From the first resolution, which needs no card lookup. */
  early: FormatResolution | null;
}

/** Collects violations per file, and drops exact duplicates. */
class Results {
  private readonly files = new Map<string, FileResult>();
  private readonly seen = new Set<string>();

  file(path: string, formatKey: string | null = null): FileResult {
    let r = this.files.get(path);
    if (r === undefined) {
      r = { path, formatKey, violations: [] };
      this.files.set(path, r);
    } else if (formatKey !== null) {
      r.formatKey = formatKey;
    }
    return r;
  }

  add(vs: readonly Violation[]): void {
    for (const v of vs) {
      const key = JSON.stringify([v.code, v.file, v.line, v.message]);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.file(v.file).violations.push(v);
    }
  }

  list(): FileResult[] {
    return [...this.files.values()]
      .map((r) => ({ ...r, violations: sortViolations(r.violations) }))
      .sort((a, b) => compareCodePoints(a.path, b.path));
  }
}

const hasError = (vs: readonly Violation[]): boolean =>
  vs.some((v) => v.severity === "error");

/**
 * The six steps of `validate`: scan the repo, parse the gauntlets and resolve their
 * formats, refresh the card data, select the decks, check them, and build the
 * report. The caller prints it and turns it into an exit code.
 */
export async function validate(
  opts: ValidateOptions,
): Promise<ValidateOutcome> {
  mkdirSync(opts.dataDir, { recursive: true });
  const git = new Git({ dataDir: opts.dataDir });

  // The base commit is resolved first, so a bad ref is a usage error before any
  // network traffic.
  let changes: Change[] = [];
  if ("changedSince" in opts.selection) {
    try {
      const base = await git.revParse(
        opts.repoDir,
        opts.selection.changedSince,
      );
      changes = await git.diffNameStatus(opts.repoDir, base);
    } catch {
      return {
        kind: "usage",
        message: `--changed-since: "${opts.selection.changedSince}" does not resolve to a commit in ${opts.repoDir}`,
      };
    }
  }

  // 1. Scan.
  const contents: RepoContents = await scanRepo(opts.repoDir);

  // 2. Parse every gauntlet.yaml and resolve its format. The card-name check of a
  //    custom format needs card data, so it comes after the refresh.
  const gauntlets: GauntletState[] = [];
  const builds = new Map<string, FormatBuild>();
  for (const g of contents.gauntlets) {
    const yamlPath = `${g.folder}/gauntlet.yaml`;
    const parsed = parseGauntlet(g.yamlText, yamlPath);
    const state: GauntletState = {
      folder: g.folder,
      yamlPath,
      def: hasError(parsed.violations) ? null : parsed.def,
      violations: parsed.violations,
      early: null,
    };
    if (state.def !== null) {
      state.early = await resolveFormat(state.def, contents, {
        presetsDir: opts.presetsDir,
        file: yamlPath,
      });
      if (!isFormatFailure(state.early))
        builds.set(state.early.key, {
          key: state.early.key,
          def: state.early.def,
        });
    }
    gauntlets.push(state);
  }

  // 3. Refresh the card data. A failed refresh falls back to the cached data.
  const formatDefs = [...builds.values()];
  const refresh = await refreshCardData({
    baseUrl: opts.baseUrl,
    dataDir: opts.dataDir,
    formatDefs,
    ...(opts.minCards === undefined ? {} : { minCards: opts.minCards }),
  });
  const opened = await openCurrent(opts.dataDir, {
    formatDefs,
    verifyChecksum: refresh.status !== "updated",
  });
  if (!opened.ok) {
    const why =
      refresh.status === "failed" && refresh.error !== undefined
        ? `${refresh.error.message}; `
        : "";
    return {
      kind: "infrastructure",
      message: `No usable card data in ${opts.dataDir}: ${why}${
        opened.reason === "no-data"
          ? "there is no cached copy"
          : "the cached copy is damaged"
      }.`,
    };
  }
  const lookup: SqliteCardLookup = opened.lookup;
  try {
    const results = new Results();
    if (refresh.status === "failed") {
      const e = refresh.error;
      results.add([
        violation(
          "W-STALE-DATA",
          "",
          `The card data could not be refreshed${e === undefined ? "" : ` (${e.message})`}. Using the cached MTGJSON ${opened.current.version} from ${opened.current.date}.`,
        ),
      ]);
    }

    // 4. Select the decks.
    const allDecks = contents.gauntlets.flatMap((g) =>
      g.decks.map((d) => d.path),
    );
    const all = "all" in opts.selection;
    const selected = new Set(all ? allDecks : affectedDecks(changes, contents));
    const changed = new Set(changes.map((c) => c.path));
    const inScope = (g: GauntletState): boolean =>
      all ||
      contents.gauntlets
        .find((c) => c.folder === g.folder)
        ?.decks.some((d) => selected.has(d.path)) === true ||
      [...changed].some((p) => p.startsWith(`${g.folder}/`));

    // Scan problems, for the files in scope.
    results.add(
      contents.errors.filter(
        (v) => all || changed.has(v.file) || selected.has(v.file),
      ),
    );

    // Gauntlets and their formats, now with the card-name check.
    const resolved = new Map<string, ResolvedFormat>();
    for (const g of gauntlets) {
      if (!inScope(g)) continue;
      results.add(g.violations);
      if (g.def === null) continue;
      const r = await resolveFormat(g.def, contents, {
        presetsDir: opts.presetsDir,
        file: g.yamlPath,
        lookup,
      });
      if (isFormatFailure(r)) results.add(r.violations);
      else resolved.set(g.folder, r);
    }
    for (const f of contents.formats) {
      if (!all && !changed.has(f.path)) continue;
      const parsed = parseFormatDef(f.text, f.path);
      results.add(parsed.violations);
      if (parsed.def !== null)
        results.add(checkFormatDef(parsed.def, { file: f.path, lookup }));
    }

    // 5. Check each selected deck. The decks of a gauntlet whose format failed are
    //    not checked.
    let decksChecked = 0;
    for (const g of contents.gauntlets) {
      const format = resolved.get(g.folder);
      if (format === undefined) continue;
      const rules: FormatDef | OfficialRules =
        format.ref.kind === "official"
          ? officialRules(format.ref.name)
          : (format.def as FormatDef);
      for (const d of g.decks) {
        if (!selected.has(d.path)) continue;
        const { violations } = checkDeck(
          parseDeck(d.text, d.path),
          rules,
          format.key,
          lookup,
        );
        results.file(d.path, format.key);
        results.add(violations);
        decksChecked++;
      }
    }

    // 6. The report.
    return {
      kind: "report",
      report: {
        engineVersion: ENGINE_VERSION,
        mtgjson: {
          version: opened.current.version,
          date: opened.current.date,
        },
        results: results.list(),
        decksChecked,
      },
    };
  } finally {
    lookup.close();
  }
}
