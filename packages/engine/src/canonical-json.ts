/**
 * Canonical JSON as in RFC 8785 (JSON Canonicalization Scheme): object keys sorted
 * by UTF-16 code units, no whitespace, strings and numbers in ECMAScript form.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("canonicalJson: numbers must be finite");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v: unknown) => canonicalJson(v)).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(obj).sort()) {
        const v = obj[key];
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot serialise a ${typeof value}`);
  }
}
