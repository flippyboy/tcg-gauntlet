import type { CardLookup, CopyExempt, FormatDef, Violation } from "../types.js";
import { validateFormatDefinition } from "../generated/validators.js";
import { violation } from "../util.js";
import { checkYamlDocument } from "./schema-check.js";

export interface FormatDefResult {
  def: FormatDef | null;
  violations: Violation[];
}

/** Parses and checks a format definition file. Defaults are filled in. */
export function parseFormatDef(text: string, file: string): FormatDefResult {
  const res = checkYamlDocument(text, {
    file,
    lineOffset: 0,
    syntaxCode: "E-SCHEMA-INVALID",
    validator: validateFormatDefinition,
  });
  if (res.value === null) return { def: null, violations: res.violations };
  const v = res.value;
  const deck = (v["deck"] ?? {}) as Record<string, unknown>;
  const list = (k: string): string[] => (v[k] as string[] | undefined) ?? [];
  const over = (k: string): { name: string; reason: string }[] =>
    (v[k] as { name: string; reason: string }[] | undefined) ?? [];
  const def: FormatDef = {
    schema_version: v["schema_version"] as number,
    id: v["id"] as string,
    name: v["name"] as string,
    legality_by: "name",
    sets: v["sets"] as string[],
    banned: list("banned"),
    restricted: list("restricted"),
    include: over("include"),
    exclude: over("exclude"),
    deck: {
      min_main: (deck["min_main"] as number | undefined) ?? 60,
      max_sideboard: (deck["max_sideboard"] as number | undefined) ?? 15,
      max_copies: (deck["max_copies"] as number | undefined) ?? 4,
      copy_exempt: (deck["copy_exempt"] as CopyExempt[] | undefined) ?? [
        "basic_lands",
        "any_number_text",
      ],
    },
  };
  if (typeof deck["max_main"] === "number")
    def.deck.max_main = deck["max_main"];
  return { def, violations: res.violations };
}

export interface CheckFormatContext {
  file: string;
  /** For a preset: the id from the reference. It must equal `def.id`. */
  expectedId?: string;
  /** Finds cards. Names that match no card give E-FORMAT-INVALID. */
  lookup: Pick<CardLookup, "findCard">;
}

/** The rules beyond the schema (spec/format-definition.md). */
export function checkFormatDef(
  def: FormatDef,
  ctx: CheckFormatContext,
): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string): void => {
    out.push(violation("E-FORMAT-INVALID", ctx.file, message));
  };
  if (ctx.expectedId !== undefined && def.id !== ctx.expectedId) {
    bad(`The id "${def.id}" does not match the reference "${ctx.expectedId}"`);
  }
  if (
    def.deck.max_main !== undefined &&
    def.deck.max_main < def.deck.min_main
  ) {
    bad(
      `max_main (${def.deck.max_main}) is smaller than min_main (${def.deck.min_main})`,
    );
  }
  const lists: [string, string[]][] = [
    ["banned", def.banned],
    ["restricted", def.restricted],
    ["include", def.include.map((o) => o.name)],
    ["exclude", def.exclude.map((o) => o.name)],
  ];
  for (const [list, names] of lists) {
    for (const name of names) {
      if (ctx.lookup.findCard(name) === null) {
        bad(`"${name}" in ${list} is not a card`);
      }
    }
  }
  return out;
}
