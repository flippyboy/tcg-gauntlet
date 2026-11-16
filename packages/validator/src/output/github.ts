import { isAbsolute, join, relative, sep } from "node:path";
import * as core from "@actions/core";
import { countSeverity, type FileResult, type Report } from "../types.js";
import { describeViolation } from "./text.js";

export interface GithubOptions {
  /** The deck repo directory (`--repo`), absolute. */
  repoDir: string;
  /** `GITHUB_WORKSPACE`. Annotation paths are relative to it. */
  workspace?: string | undefined;
}

/** A repo-relative path as GitHub wants it: relative to the workspace, with `/`. */
export function workspacePath(
  file: string,
  { repoDir, workspace }: GithubOptions,
): string {
  if (workspace === undefined || workspace === "") return file;
  const rel = relative(workspace, join(repoDir, file));
  if (rel.startsWith("..") || isAbsolute(rel)) return file;
  return rel.split(sep).join("/");
}

/** The summary table is HTML, so text from a deck repo is escaped. */
const html = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function status(r: FileResult): string {
  const errors = r.violations.filter((v) => v.severity === "error").length;
  const warnings = r.violations.length - errors;
  if (errors > 0) return `${errors} error${errors === 1 ? "" : "s"}`;
  if (warnings > 0)
    return `ok, ${warnings} warning${warnings === 1 ? "" : "s"}`;
  return "ok";
}

/**
 * Writes one annotation per violation (`core.error` for E- codes, `core.warning`
 * for W- codes), and the result table to the step summary. GitHub shows only a
 * limited number of annotations, so the table always carries the full result.
 */
export async function writeGithub(
  report: Report,
  opts: GithubOptions,
): Promise<void> {
  for (const r of report.results) {
    for (const v of r.violations) {
      const props: core.AnnotationProperties = { title: v.code };
      if (r.path !== "") {
        props.file = workspacePath(r.path, opts);
        if (v.line !== undefined) props.startLine = v.line;
      }
      const message = describeViolation(v);
      if (v.severity === "error") core.error(message, props);
      else core.warning(message, props);
    }
  }

  const errors = countSeverity(report, "error");
  const warnings = countSeverity(report, "warning");
  core.info(
    `${report.decksChecked} deck(s) checked, ${errors} error(s), ${warnings} warning(s).`,
  );

  if (!process.env["GITHUB_STEP_SUMMARY"]) return;
  const rows = report.results
    .filter((r) => r.violations.length > 0 || r.formatKey !== null)
    .map((r) => [
      html(r.path === "" ? "(card data)" : r.path),
      status(r),
      r.violations
        .map(
          (v) =>
            `${v.code}${v.line === undefined ? "" : ` (line ${v.line})`}: ${describeViolation(v)}`,
        )
        .map(html)
        .join("<br>"),
    ]);
  core.summary.addHeading("TCG Gauntlet validation", 2);
  core.summary.addRaw(
    `${report.decksChecked} deck(s) checked, ${errors} error(s), ${warnings} warning(s).` +
      (report.mtgjson === null
        ? ""
        : ` Card data: MTGJSON ${report.mtgjson.version} (${report.mtgjson.date}).`),
    true,
  );
  if (rows.length > 0) {
    core.summary.addTable([
      [
        { data: "File", header: true },
        { data: "Result", header: true },
        { data: "Problems", header: true },
      ],
      ...rows,
    ]);
  }
  await core.summary.write();
}
