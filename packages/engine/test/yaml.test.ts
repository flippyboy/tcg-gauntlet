import { describe, expect, it } from "vitest";
import { MAX_YAML_BYTES, parseYamlLimited } from "../src/index.js";

function ok(text: string, offset = 0) {
  const r = parseYamlLimited(text, offset);
  if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.message}`);
  return r;
}

describe("parseYamlLimited", () => {
  it("parses YAML 1.2 and keeps the Norway problem away", () => {
    const r = ok("country: no\nflag: yes\nversion: 1.0\nempty:\n");
    expect(r.value).toEqual({
      country: "no",
      flag: "yes",
      version: 1,
      empty: null,
    });
  });

  it("returns null for an empty document", () => {
    expect(ok("").value).toBeNull();
    expect(ok("# only a comment\n").value).toBeNull();
  });

  it("reports the line of each key, plus the offset", () => {
    const r = ok("a: 1\nb:\n  c: 2\n  d: [x, y]\n", 10);
    expect(r.lines.get("/a")).toBe(11);
    expect(r.lines.get("/b")).toBe(12);
    expect(r.lines.get("/b/c")).toBe(13);
    expect(r.lines.get("/b/d")).toBe(14);
    expect(r.lines.get("/b/d/1")).toBe(14);
    expect(r.firstLine).toBe(11);
    expect(r.lines.get("")).toBe(11);
  });

  it("escapes ~ and / in pointers", () => {
    const r = ok("'a/b': 1\n'c~d': 2\n");
    expect(r.lines.get("/a~1b")).toBe(1);
    expect(r.lines.get("/c~0d")).toBe(2);
  });

  it("uses the first line of a document that is not a mapping", () => {
    expect(ok("- a\n- b\n").firstLine).toBe(1);
    expect(ok("just text\n", 4).firstLine).toBe(5);
  });

  it("refuses aliases and anchors", () => {
    for (const text of [
      "a: &x 1\nb: *x\n",
      "a: &x 1\n",
      "a: &x [1]\nb: *x\n",
    ]) {
      const r = parseYamlLimited(text);
      expect(r).toMatchObject({ ok: false, kind: "syntax" });
    }
    const r = parseYamlLimited("a: 1\nb: &x 2\n", 3);
    expect(r).toMatchObject({ ok: false, line: 5 });
  });

  it("refuses repeated keys", () => {
    const r = parseYamlLimited("a: 1\nb: 2\na: 3\n", 1);
    expect(r).toMatchObject({ ok: false, kind: "syntax", line: 4 });
  });

  it("reports a syntax error with its line", () => {
    const r = parseYamlLimited("a: [1, 2\nb: 3\n");
    expect(r).toMatchObject({ ok: false, kind: "syntax" });
  });

  it("refuses input over 64 KB", () => {
    const big = `a: "${"x".repeat(MAX_YAML_BYTES)}"\n`;
    expect(parseYamlLimited(big)).toMatchObject({ ok: false, kind: "limit" });
    const fits = `a: "${"x".repeat(MAX_YAML_BYTES - 20)}"\n`;
    expect(parseYamlLimited(fits).ok).toBe(true);
  });

  it("counts bytes, not characters, for the size limit", () => {
    const text = `a: "${"é".repeat(MAX_YAML_BYTES / 2)}"\n`;
    expect(parseYamlLimited(text)).toMatchObject({ ok: false, kind: "limit" });
  });

  it("allows nesting of 10 levels and refuses 11", () => {
    const nest = (levels: number): string => {
      let s = "x";
      for (let i = 0; i < levels - 1; i++) s = `{a: ${s}}`;
      return `k: ${s}\n`;
    };
    // `k: {a: ...}` : the top mapping is level 1.
    expect(parseYamlLimited(nest(10)).ok).toBe(true);
    expect(parseYamlLimited(nest(11))).toMatchObject({
      ok: false,
      kind: "limit",
    });
    const seq = (levels: number): string =>
      `${"[".repeat(levels)}${"]".repeat(levels)}`;
    expect(parseYamlLimited(`k: ${seq(9)}\n`).ok).toBe(true);
    expect(parseYamlLimited(`k: ${seq(10)}\n`)).toMatchObject({
      ok: false,
      kind: "limit",
    });
  });
});
