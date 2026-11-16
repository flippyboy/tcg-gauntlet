import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type CardLookup,
  type FormatDef,
  type OfficialRules,
  type Violation,
  checkDeck,
  checkFormatDef,
  exportDec,
  exportMtga,
  exportMtgo,
  formatKey,
  officialRules,
  parseDeck,
  parseFormatDef,
  parseFormatRef,
  sortViolations,
} from "@tcg-gauntlet/engine";

export interface RunOptions {
  /** `conformance/cases`. */
  casesDir: string;
  /** `presets`. */
  presetsDir: string;
}

export interface ExpectedViolation {
  code: string;
  line?: number;
}

export interface CaseSpec {
  description?: string;
  format: string;
  expectedViolations: ExpectedViolation[];
  /** Line number to `SET/NUM`. */
  expectedPrintings?: Record<string, string>;
  /** Violations the MTGA export is expected to return. */
  expectedMtgaWarnings?: ExpectedViolation[];
}

export interface Mismatch {
  case: string;
  check: string;
  message: string;
}

const describe = (v: ExpectedViolation | Violation): string =>
  `${v.code}${v.line === undefined ? "" : `@${v.line}`}`;

function sameViolations(
  name: string,
  check: string,
  expected: ExpectedViolation[],
  actual: Violation[],
  out: Mismatch[],
): void {
  const e = sortViolations(
    expected.map(
      (x) =>
        ({
          ...x,
          severity: "error" as const,
          file: "",
          message: "",
        }) as Violation,
    ),
  ).map(describe);
  const a = sortViolations(actual).map(describe);
  if (e.join(" ") !== a.join(" ")) {
    out.push({
      case: name,
      check,
      message: `expected [${e.join(", ")}] but got [${a.join(", ")}]`,
    });
  }
}

/**
 * Runs every case folder in `casesDir` against `lookup`. Each folder has
 * `deck.txt` and `case.json`, and may have `expected.mtgo.txt`, `expected.dec` and
 * `expected.mtga.txt`. Returns the list of mismatches. An empty list means success.
 */
export async function runConformance(
  lookup: CardLookup,
  opts: RunOptions,
): Promise<Mismatch[]> {
  const out: Mismatch[] = [];
  const names = readdirSync(opts.casesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    try {
      await runCase(lookup, opts, name, out);
    } catch (e) {
      out.push({
        case: name,
        check: "run",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

async function runCase(
  lookup: CardLookup,
  opts: RunOptions,
  name: string,
  out: Mismatch[],
): Promise<void> {
  const dir = join(opts.casesDir, name);
  const spec = JSON.parse(
    readFileSync(join(dir, "case.json"), "utf8"),
  ) as CaseSpec;
  const deckBytes = new Uint8Array(readFileSync(join(dir, "deck.txt")));

  // Resolve the format.
  const ref = parseFormatRef(spec.format);
  if (ref === null) {
    out.push({
      case: name,
      check: "format",
      message: `bad format reference ${spec.format}`,
    });
    return;
  }
  let rules: FormatDef | OfficialRules;
  let key: string;
  let formatName: string;
  if (ref.kind === "official") {
    rules = officialRules(ref.name);
    key = await formatKey(ref.ref, null);
    formatName = rules.name;
  } else if (ref.kind === "preset") {
    const file = `${ref.id}@${ref.revision}.yaml`;
    const parsed = parseFormatDef(
      readFileSync(join(opts.presetsDir, file), "utf8"),
      `presets/${file}`,
    );
    const problems = [
      ...parsed.violations,
      ...(parsed.def
        ? checkFormatDef(parsed.def, {
            file: `presets/${file}`,
            expectedId: ref.id,
            lookup,
          })
        : []),
    ];
    if (parsed.def === null || problems.length > 0) {
      out.push({
        case: name,
        check: "format",
        message: `preset ${file} is invalid: ${problems.map((p) => `${p.code} ${p.message}`).join("; ")}`,
      });
      return;
    }
    rules = parsed.def;
    key = await formatKey(ref.ref, parsed.def);
    formatName = parsed.def.name;
    lookup.registerFormat?.(key, parsed.def);
  } else {
    out.push({
      case: name,
      check: "format",
      message: "repo: formats are not supported in cases",
    });
    return;
  }

  const parsedDeck = parseDeck(deckBytes, `${name}.txt`);
  const { resolved, violations } = checkDeck(parsedDeck, rules, key, lookup);
  sameViolations(name, "violations", spec.expectedViolations, violations, out);

  for (const [line, want] of Object.entries(spec.expectedPrintings ?? {})) {
    const entry = resolved.entries.find((e) => e.line.line === Number(line));
    const got = entry?.printing
      ? `${entry.printing.set}/${entry.printing.number}`
      : "none";
    if (got !== want) {
      out.push({
        case: name,
        check: "printing",
        message: `line ${line}: expected ${want} but got ${got}`,
      });
    }
  }

  const exports: [
    string,
    string,
    () => { text: string; warnings: Violation[] },
  ][] = [
    ["expected.mtgo.txt", "export-mtgo", () => exportMtgo(resolved)],
    ["expected.dec", "export-dec", () => exportDec(resolved, { formatName })],
    ["expected.mtga.txt", "export-mtga", () => exportMtga(resolved, lookup)],
  ];
  for (const [file, check, run] of exports) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const want = readFileSync(path, "utf8");
    const got = run();
    if (got.text !== want) {
      out.push({
        case: name,
        check,
        message: `${file} differs: expected ${JSON.stringify(want)} but got ${JSON.stringify(got.text)}`,
      });
    }
    if (file === "expected.mtga.txt") {
      sameViolations(
        name,
        "mtga-warnings",
        spec.expectedMtgaWarnings ?? [],
        got.warnings,
        out,
      );
    }
  }
}
