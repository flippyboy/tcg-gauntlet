import { canonicalJson } from "./canonical-json.js";
import type { FormatDef, FormatKey } from "./types.js";
import { compareCodePoints } from "./util.js";

const sorted = (xs: readonly string[]): string[] =>
  [...xs].sort(compareCodePoints);

const overrides = (xs: readonly { name: string }[]): { name: string }[] =>
  xs
    .map((x) => ({ name: x.name }))
    .sort((a, b) => compareCodePoints(a.name, b.name));

/**
 * The definition in the form that is hashed (spec/format-definition.md, "Format
 * keys"): defaults filled in, lists sorted, `reason` removed.
 */
export function canonicalFormatDef(def: FormatDef): Record<string, unknown> {
  const deck: Record<string, unknown> = {
    min_main: def.deck.min_main,
    max_sideboard: def.deck.max_sideboard,
    max_copies: def.deck.max_copies,
    copy_exempt: sorted(def.deck.copy_exempt),
  };
  if (def.deck.max_main !== undefined) deck["max_main"] = def.deck.max_main;
  return {
    schema_version: def.schema_version,
    id: def.id,
    name: def.name,
    legality_by: def.legality_by,
    sets: sorted(def.sets),
    banned: sorted(def.banned),
    restricted: sorted(def.restricted),
    include: overrides(def.include),
    exclude: overrides(def.exclude),
    deck,
  };
}

/**
 * `<ref>#<hash12>` for a custom format, `<ref>#mtgjson` for an official one (pass
 * `null` as the definition). `ref` is the normalised format reference.
 */
export async function formatKey(
  ref: string,
  def: FormatDef | null,
): Promise<FormatKey> {
  if (def === null) return `${ref}#mtgjson`;
  const bytes = new TextEncoder().encode(
    canonicalJson(canonicalFormatDef(def)),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return `${ref}#${hex.slice(0, 12)}`;
}
