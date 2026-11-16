import type { FrontMatter, Violation } from "../types.js";
import { violation } from "../util.js";
import { validateDeckFrontMatter } from "../generated/validators.js";
import { checkYamlDocument } from "./schema-check.js";

export interface FrontMatterSplit {
  /** True when the file starts with a `---` line. */
  present: boolean;
  /** The YAML between the two `---` lines. */
  yaml: string;
  /** Index (0-based) of the first list line. 0 when there is no block. */
  listStart: number;
  /** The opening `---` has no closing `---`. */
  unterminated: boolean;
}

const FENCE = /^---[ \t]*$/;

/** Splits off the leading `---` block. `lines` have no line endings. */
export function splitFrontMatter(
  lines: readonly (string | null)[],
): FrontMatterSplit {
  const first = lines[0];
  if (first === null || first === undefined || !FENCE.test(first)) {
    return { present: false, yaml: "", listStart: 0, unterminated: false };
  }
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l !== null && l !== undefined && FENCE.test(l)) {
      return {
        present: true,
        yaml: lines
          .slice(1, i)
          .map((x) => x ?? "")
          .join("\n"),
        listStart: i + 1,
        unterminated: false,
      };
    }
  }
  return {
    present: true,
    yaml: "",
    listStart: lines.length,
    unterminated: true,
  };
}

export interface FrontMatterResult {
  frontMatter: FrontMatter;
  schemaVersion: number;
  errors: Violation[];
  warnings: Violation[];
}

/**
 * Parses and checks the YAML of a front matter block. The block starts on line 2
 * of the file, so key lines are counted from there.
 */
export function parseFrontMatter(
  yaml: string,
  file: string,
): FrontMatterResult {
  const res = checkYamlDocument(yaml, {
    file,
    lineOffset: 1,
    syntaxCode: "E-PARSE-FRONTMATTER",
    validator: validateDeckFrontMatter,
    unknownFieldWarning: true,
    emptyIsObject: true,
  });
  const errors = res.violations.filter((v) => v.severity === "error");
  const warnings = res.violations.filter((v) => v.severity === "warning");
  if (res.value === null) {
    return { frontMatter: {}, schemaVersion: 1, errors, warnings };
  }
  // Keep only the fields the schema knows. Unknown ones were reported as warnings.
  const known = [
    "schema_version",
    "name",
    "author",
    "archetype",
    "description",
    "tags",
    "source",
  ];
  const fm: Record<string, unknown> = {};
  for (const k of known) if (k in res.value) fm[k] = res.value[k];
  fm["schema_version"] ??= 1;
  return {
    frontMatter: fm,
    schemaVersion: fm["schema_version"] as number,
    errors,
    warnings,
  };
}

export function unterminatedFrontMatter(file: string): Violation {
  return violation(
    "E-PARSE-FRONTMATTER",
    file,
    "The front matter starts with --- but has no closing ---",
    1,
  );
}
