import { describe, expect, it } from "vitest";
import { parseDeck, parseFrontMatter, splitFrontMatter } from "../src/index.js";

const codes = (d: ReturnType<typeof parseDeck>): string[] =>
  [...d.parseErrors, ...d.warnings].map((v) => `${v.code}@${v.line ?? "-"}`);

describe("splitFrontMatter", () => {
  it("returns no block when the file does not start with ---", () => {
    expect(splitFrontMatter(["4 Bolt", "---"])).toEqual({
      present: false,
      yaml: "",
      listStart: 0,
      unterminated: false,
    });
    expect(splitFrontMatter([]).present).toBe(false);
    expect(splitFrontMatter([null, "---"]).present).toBe(false);
  });

  it("splits a block, allowing trailing whitespace on the fences", () => {
    const s = splitFrontMatter(["---  ", "a: 1", "b: 2", "--- \t", "4 Bolt"]);
    expect(s).toEqual({
      present: true,
      yaml: "a: 1\nb: 2",
      listStart: 4,
      unterminated: false,
    });
  });

  it("flags an unterminated block", () => {
    expect(splitFrontMatter(["---", "a: 1", null, "4 Bolt"]).unterminated).toBe(
      true,
    );
  });

  it("does not take a fence with other text for a fence", () => {
    expect(splitFrontMatter(["---", "a: 1", "---x", "----"]).unterminated).toBe(
      true,
    );
  });
});

describe("front matter in a deck file", () => {
  it("has no fields when the block is missing", () => {
    const d = parseDeck("4 Lightning Bolt\n", "a.txt");
    expect(d.frontMatter).toEqual({});
    expect(d.schemaVersion).toBe(1);
    expect(d.lines[0]?.line).toBe(1);
  });

  it("reads all fields and counts list lines from the top of the file", () => {
    const d = parseDeck(
      "---\nschema_version: 1\nname: Burn\nauthor: Me\narchetype: Aggro\ndescription: d\ntags: [a, b]\nsource: https://x.example\n---\n4 Lightning Bolt\n",
      "a.txt",
    );
    expect(codes(d)).toEqual([]);
    expect(d.frontMatter).toEqual({
      schema_version: 1,
      name: "Burn",
      author: "Me",
      archetype: "Aggro",
      description: "d",
      tags: ["a", "b"],
      source: "https://x.example",
    });
    expect(d.lines[0]?.line).toBe(10);
  });

  it("treats an empty block as no fields", () => {
    const d = parseDeck("---\n---\n4 Lightning Bolt\n", "a.txt");
    expect(codes(d)).toEqual([]);
    expect(d.frontMatter).toEqual({ schema_version: 1 });
    expect(d.lines[0]?.line).toBe(3);
  });

  it("gives E-PARSE-FRONTMATTER for an unterminated block, and reads no list", () => {
    const d = parseDeck("---\nname: x\n4 Lightning Bolt\n", "a.txt");
    expect(codes(d)).toEqual(["E-PARSE-FRONTMATTER@1"]);
    expect(d.lines).toEqual([]);
  });

  it("gives E-PARSE-FRONTMATTER for invalid YAML, aliases and repeated keys", () => {
    expect(codes(parseDeck("---\nname: [x\n---\n", "a.txt"))[0]).toMatch(
      /^E-PARSE-FRONTMATTER@/,
    );
    expect(
      codes(parseDeck("---\nname: &a x\ntags: [*a]\n---\n", "a.txt"))[0],
    ).toBe("E-PARSE-FRONTMATTER@2");
    expect(codes(parseDeck("---\nname: a\nname: b\n---\n", "a.txt"))).toEqual([
      "E-PARSE-FRONTMATTER@3",
    ]);
  });

  it("gives E-LIMIT-EXCEEDED for a block over 64 KB", () => {
    const d = parseDeck(
      `---\ndescription: ${"x".repeat(70000)}\n---\n4 Lightning Bolt\n`,
      "a.txt",
    );
    expect(codes(d)).toEqual(["E-LIMIT-EXCEEDED@2"]);
  });

  it("warns about an unknown field on the line of its key, and keeps the rest", () => {
    const d = parseDeck(
      "---\nname: Burn\nowner: me\nother: 1\n---\n4 Lightning Bolt\n",
      "a.txt",
    );
    expect(codes(d)).toEqual([
      "W-FRONTMATTER-UNKNOWN-FIELD@3",
      "W-FRONTMATTER-UNKNOWN-FIELD@4",
    ]);
    expect(d.warnings[0]?.severity).toBe("warning");
    expect(d.warnings[0]?.message).toContain("owner");
    expect(d.frontMatter.name).toBe("Burn");
    expect(d.frontMatter).not.toHaveProperty("owner");
  });

  it("gives E-SCHEMA-INVALID, on the key's line, for a field that breaks the schema", () => {
    const d = parseDeck(
      "---\nname: ''\ntags: [a, a]\nsource: ftp://x\nauthor: 5\nowner: x\n---\n",
      "a.txt",
    );
    expect(codes(d)).toEqual([
      "E-SCHEMA-INVALID@2",
      "E-SCHEMA-INVALID@3",
      "E-SCHEMA-INVALID@4",
      "E-SCHEMA-INVALID@5",
      "W-FRONTMATTER-UNKNOWN-FIELD@6",
    ]);
    expect(d.frontMatter).toEqual({});
  });

  it("checks schema_version before the schema", () => {
    const d = parseDeck("---\nname: ''\nschema_version: 2\n---\n", "a.txt");
    expect(codes(d)).toEqual(["E-SCHEMA-VERSION@3"]);
  });

  it("gives E-SCHEMA-INVALID for a schema_version that is not an integer", () => {
    for (const v of ["one", "1.5", "[1]"]) {
      const c = codes(parseDeck(`---\nschema_version: ${v}\n---\n`, "a.txt"));
      expect(c.length).toBeGreaterThan(0);
      expect(c.every((x) => x === "E-SCHEMA-INVALID@2")).toBe(true);
    }
  });

  it("gives E-SCHEMA-INVALID when the block is not a mapping", () => {
    const d = parseDeck("---\n- a\n- b\n---\n", "a.txt");
    expect(codes(d)).toEqual(["E-SCHEMA-INVALID@2"]);
  });

  it("limits characters, not UTF-16 units", () => {
    // 120 astral characters are 240 UTF-16 units but 120 code points.
    const d = parseDeck(
      `---\nname: ${"\u{1F600}".repeat(120)}\n---\n`,
      "a.txt",
    );
    expect(codes(d)).toEqual([]);
    const d2 = parseDeck(
      `---\nname: ${"\u{1F600}".repeat(121)}\n---\n`,
      "a.txt",
    );
    expect(codes(d2)).toEqual(["E-SCHEMA-INVALID@2"]);
  });
});

describe("parseFrontMatter", () => {
  it("fills in schema_version", () => {
    const r = parseFrontMatter("name: x", "a.txt");
    expect(r.frontMatter).toEqual({ name: "x", schema_version: 1 });
    expect(r.schemaVersion).toBe(1);
  });
});
