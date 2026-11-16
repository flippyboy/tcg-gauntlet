import type { Violation } from "@tcg-gauntlet/engine";
import { countSeverity, type Report } from "../types.js";

/** `message (did you mean …)` */
export function describeViolation(v: Violation): string {
  return v.suggestion === undefined || v.suggestion === ""
    ? v.message
    : `${v.message} (did you mean ${v.suggestion})`;
}

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line per violation, grouped by file, then a summary line. */
export function formatText(report: Report): string {
  const out: string[] = [];
  for (const r of report.results) {
    if (r.violations.length === 0) continue;
    const name = r.path === "" ? "(card data)" : r.path;
    out.push(name);
    for (const v of r.violations) {
      const where =
        r.path === ""
          ? ""
          : `${r.path}${v.line === undefined ? "" : `:${v.line}`} `;
      out.push(`  ${where}${v.code} ${describeViolation(v)}`);
    }
    out.push("");
  }
  if (report.decksChecked === 0) out.push("No decks affected.");
  const errors = countSeverity(report, "error");
  const warnings = countSeverity(report, "warning");
  out.push(
    `${plural(report.decksChecked, "deck")} checked, ${plural(errors, "error")}, ${plural(warnings, "warning")}.`,
  );
  return out.join("\n") + "\n";
}
