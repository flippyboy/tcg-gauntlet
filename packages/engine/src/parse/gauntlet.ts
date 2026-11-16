import type { FormatRef, GauntletDef, Violation } from "../types.js";
import { validateGauntlet } from "../generated/validators.js";
import { isOfficialFormatName } from "../official-formats.js";
import { checkYamlDocument } from "./schema-check.js";

export interface GauntletResult {
  def: GauntletDef | null;
  violations: Violation[];
}

/** Parses and checks `gauntlet.yaml`. Defaults are filled in. */
export function parseGauntlet(
  text: string,
  file = "gauntlet.yaml",
): GauntletResult {
  const res = checkYamlDocument(text, {
    file,
    lineOffset: 0,
    syntaxCode: "E-SCHEMA-INVALID",
    validator: validateGauntlet,
  });
  if (res.value === null) return { def: null, violations: res.violations };
  const v = res.value;
  const def: GauntletDef = {
    schema_version:
      typeof v["schema_version"] === "number" ? v["schema_version"] : 1,
    name: v["name"] as string,
    format: v["format"] as string,
  };
  if (typeof v["description"] === "string") def.description = v["description"];
  return { def, violations: res.violations };
}

/**
 * Normalises a `format` value (already checked by the schema): a bare official
 * name becomes `official:<name>`. Returns null when it is none of the four forms.
 */
export function parseFormatRef(format: string): FormatRef | null {
  let m = /^preset:([a-z0-9-]{1,40})@([0-9]{1,4})$/.exec(format);
  if (m) {
    return {
      kind: "preset",
      ref: format,
      id: m[1] ?? "",
      revision: Number(m[2]),
    };
  }
  m = /^repo:(formats\/[A-Za-z0-9._-]{1,100}\.yaml)$/.exec(format);
  if (m) return { kind: "repo", ref: format, path: m[1] ?? "" };
  m = /^(?:official:)?([a-z]+)$/.exec(format);
  const name = m?.[1];
  if (name !== undefined && isOfficialFormatName(name)) {
    return { kind: "official", ref: `official:${name}`, name };
  }
  return null;
}
