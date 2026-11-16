import type { Violation } from "@tcg-gauntlet/engine";

/** The violations found in one file. A deck that passes has an empty list. */
export interface FileResult {
  /** Path relative to the deck repo root. Empty for a problem with no file. */
  path: string;
  /** The format key of a deck, null for every other kind of file. */
  formatKey: string | null;
  violations: Violation[];
}

export interface Report {
  engineVersion: string;
  /** The card data version in use. Null when there is none. */
  mtgjson: { version: string; date: string } | null;
  results: FileResult[];
  /** How many decks were checked. */
  decksChecked: number;
}

export type OutputMode = "text" | "json" | "github";

export const OUTPUT_MODES: readonly OutputMode[] = ["text", "json", "github"];

/** The number of violations of one severity in a report. */
export function countSeverity(
  report: Report,
  severity: Violation["severity"],
): number {
  let n = 0;
  for (const r of report.results)
    for (const v of r.violations) if (v.severity === severity) n++;
  return n;
}

/** Exit code from spec/error-codes.md: 1 when any E- code was reported, else 0. */
export function exitCodeOf(report: Report): 0 | 1 {
  return countSeverity(report, "error") > 0 ? 1 : 0;
}
