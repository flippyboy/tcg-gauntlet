import type { ErrorCode, Severity, Violation } from "./types.js";

export function severityOf(code: ErrorCode): Severity {
  return code.startsWith("W-") ? "warning" : "error";
}

export function violation(
  code: ErrorCode,
  file: string,
  message: string,
  line?: number,
  suggestion?: string,
): Violation {
  const v: Violation = { code, severity: severityOf(code), file, message };
  if (line !== undefined) v.line = line;
  if (suggestion !== undefined) v.suggestion = suggestion;
  return v;
}

/** Orders two strings by Unicode code point. */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done === true) return y.done === true ? 0 : -1;
    if (y.done === true) return 1;
    const cx = x.value.codePointAt(0) ?? 0;
    const cy = y.value.codePointAt(0) ?? 0;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** Number of Unicode code points in a string. */
export function codePointLength(s: string): number {
  return [...s].length;
}

/**
 * Orders violations as the spec says: those without a line first, then by line,
 * then by code. Ties keep their input order.
 */
export function sortViolations(vs: readonly Violation[]): Violation[] {
  return vs
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const la = a.v.line;
      const lb = b.v.line;
      if (la !== lb) {
        if (la === undefined) return -1;
        if (lb === undefined) return 1;
        return la - lb;
      }
      const c = compareCodePoints(a.v.code, b.v.code);
      return c !== 0 ? c : a.i - b.i;
    })
    .map((x) => x.v);
}
