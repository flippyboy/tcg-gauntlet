import type { Report } from "../types.js";

/** `{engineVersion, mtgjson, results: [{path, formatKey, violations}]}` */
export function formatJson(report: Report): string {
  const body = {
    engineVersion: report.engineVersion,
    mtgjson: report.mtgjson,
    results: report.results,
  };
  return JSON.stringify(body, null, 2) + "\n";
}
