/**
 * Normalises a card name for matching (spec/format-definition.md, "Name matching").
 * The derived card data build uses the same function.
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ ?\/\/? ?/g, " // ")
    .trim();
}
