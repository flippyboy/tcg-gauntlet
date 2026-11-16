// The shared steps for deck front matter, gauntlet.yaml and format definitions
// (spec/README.md, "Checking order for YAML files").
import type { ErrorCode, Violation } from "../types.js";
import { sortViolations, violation } from "../util.js";
import { parseYamlLimited } from "./yaml.js";
import type { ValidationError } from "../generated/validators.js";

export const KNOWN_SCHEMA_VERSIONS: readonly number[] = [1];

export type Validator = ((data: unknown) => boolean) & {
  errors?: ValidationError[] | null;
};

export interface CheckOptions {
  file: string;
  /** Added to every line number. */
  lineOffset: number;
  /** The code for a YAML syntax error. */
  syntaxCode: "E-PARSE-FRONTMATTER" | "E-SCHEMA-INVALID";
  validator: Validator;
  /** Schema errors of this kind become this warning instead of an error. */
  unknownFieldWarning?: boolean;
  /** An empty document counts as `{}` (front matter: an empty block is no fields). */
  emptyIsObject?: boolean;
}

export interface CheckResult {
  /** The parsed document, when it passed all steps (warnings allowed). */
  value: Record<string, unknown> | null;
  violations: Violation[];
}

function pointerOf(err: ValidationError): string {
  if (err.keyword === "additionalProperties") {
    const key = String(err.params["additionalProperty"]);
    return `${err.instancePath}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  }
  return err.instancePath;
}

function describe(err: ValidationError): string {
  const where = err.instancePath === "" ? "the document" : err.instancePath;
  switch (err.keyword) {
    case "additionalProperties":
      return `Unknown field "${String(err.params["additionalProperty"])}"`;
    case "required":
      return `Missing required field "${String(err.params["missingProperty"])}"`;
    case "enum":
      return `${where} must be one of: ${JSON.stringify(err.params["allowedValues"])}`;
    default:
      return `${where} ${err.message ?? "is invalid"}`;
  }
}

/** Runs the four steps on YAML text. */
export function checkYamlDocument(
  text: string,
  opts: CheckOptions,
): CheckResult {
  const { file } = opts;
  const parsed = parseYamlLimited(text, opts.lineOffset);
  if (!parsed.ok) {
    const code: ErrorCode =
      parsed.kind === "limit" ? "E-LIMIT-EXCEEDED" : opts.syntaxCode;
    return {
      value: null,
      violations: [violation(code, file, parsed.message, parsed.line)],
    };
  }
  const { lines, firstLine } = parsed;
  const value: unknown =
    parsed.value === null && opts.emptyIsObject === true ? {} : parsed.value;
  const lineFor = (pointer: string): number => {
    let p = pointer;
    for (;;) {
      const l = lines.get(p);
      if (l !== undefined) return l;
      const cut = p.lastIndexOf("/");
      if (cut < 0) return firstLine;
      p = p.slice(0, cut);
    }
  };

  // Step 2: schema_version, before the schema runs.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sv = (value as Record<string, unknown>)["schema_version"];
    if (
      typeof sv === "number" &&
      Number.isInteger(sv) &&
      !KNOWN_SCHEMA_VERSIONS.includes(sv)
    ) {
      return {
        value: null,
        violations: [
          violation(
            "E-SCHEMA-VERSION",
            file,
            `Unknown schema_version ${sv}. This tool knows version ${KNOWN_SCHEMA_VERSIONS.join(", ")}.`,
            lineFor("/schema_version"),
          ),
        ],
      };
    }
  }

  // Step 3: the generated validator.
  const out: Violation[] = [];
  const seen = new Set<string>();
  let hardError = false;
  if (!opts.validator(value)) {
    for (const err of opts.validator.errors ?? []) {
      const warn =
        opts.unknownFieldWarning === true &&
        err.keyword === "additionalProperties";
      const code: ErrorCode = warn
        ? "W-FRONTMATTER-UNKNOWN-FIELD"
        : "E-SCHEMA-INVALID";
      const line = lineFor(pointerOf(err));
      const message = describe(err);
      const id = `${code}|${line}|${message}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!warn) hardError = true;
      out.push(violation(code, file, message, line));
    }
  }
  const sorted = sortViolations(out);
  if (hardError) return { value: null, violations: sorted };
  return {
    value: (value ?? {}) as Record<string, unknown>,
    violations: sorted,
  };
}
