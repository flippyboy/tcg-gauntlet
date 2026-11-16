import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCardLine, parseDeck } from "../src/index.js";
import { repoRoot } from "./helpers.js";

const lines = (text: string) =>
  parseDeck(text, "a.txt").lines.map((l) => ({
    n: l.line,
    c: l.count,
    name: l.rawName,
    s: l.section,
    ...(l.set !== undefined ? { set: l.set } : {}),
    ...(l.number !== undefined ? { num: l.number } : {}),
    ...(l.hint !== undefined ? { hint: l.hint } : {}),
  }));
const errors = (text: string) =>
  parseDeck(text, "a.txt").parseErrors.map((v) => `${v.code}@${v.line ?? "-"}`);

describe("card lines", () => {
  it("reads a count and a name", () => {
    expect(lines("4 Lightning Bolt")).toEqual([
      { n: 1, c: 4, name: "Lightning Bolt", s: "main" },
    ]);
  });

  it("accepts x and X after the count, and tabs and extra spaces", () => {
    expect(
      lines("4x Bolt\n4X Bolt\n4\tBolt\n4   Bolt   \n").map((l) => l.name),
    ).toEqual(["Bolt", "Bolt", "Bolt", "Bolt"]);
  });

  it("accepts counts of one to three digits that do not start with 0", () => {
    expect(lines("1 A\n12 B\n999 C").map((l) => l.c)).toEqual([1, 12, 999]);
    for (const bad of [
      "0 A",
      "01 A",
      "1000 A",
      "x A",
      "-1 A",
      "4A",
      "4",
      "four A",
    ]) {
      expect(errors(bad), bad).toEqual(["E-PARSE-LINE@1"]);
    }
  });

  it("reads a set code and a collector number", () => {
    expect(lines("4 Lightning Bolt (M11) 149")[0]).toMatchObject({
      set: "M11",
      num: "149",
    });
    expect(lines("4 Lightning Bolt (m11)")[0]).toMatchObject({ set: "m11" });
    expect(lines("4 Lightning Bolt (M11)   149")[0]).toMatchObject({
      num: "149",
    });
    expect(lines("4 Lightning Bolt\t(M11)\t149")[0]).toMatchObject({
      set: "M11",
      num: "149",
    });
  });

  it("accepts 2 to 6 letters or digits in a set code", () => {
    expect(lines("1 A (AB)")[0]?.set).toBe("AB");
    expect(lines("1 A (ABCDEF)")[0]?.set).toBe("ABCDEF");
    expect(lines("1 A (X)")[0]).toMatchObject({ name: "A (X)" });
    expect(lines("1 A (ABCDEFG)")[0]).toMatchObject({ name: "A (ABCDEFG)" });
    expect(lines("1 A (M-1)")[0]).toMatchObject({ name: "A (M-1)" });
  });

  it("accepts letters, digits, star, dash and slash in a collector number, and 0", () => {
    for (const n of ["0", "149a", "176★", "12-3", "1/2", "A1"]) {
      expect(lines(`1 Name (SET) ${n}`)[0]?.num, n).toBe(n);
    }
    expect(errors("1 Name (SET) 12 3")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("1 Name (SET) !")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("1 Name (SET) 1)")).toEqual(["E-PARSE-LINE@1"]);
  });

  it("splits the name at the last whitespace before an opening bracket", () => {
    expect(lines("1 Erase (Not the Urza's Legacy One)")[0]?.name).toBe(
      "Erase (Not the Urza's Legacy One)",
    );
    expect(
      lines("1 Erase (Not the Urza's Legacy One) (UNH) 7")[0],
    ).toMatchObject({
      name: "Erase (Not the Urza's Legacy One)",
      set: "UNH",
      num: "7",
    });
    expect(lines("1 Name(SET)")[0]?.name).toBe("Name(SET)");
  });

  it("keeps split-card names as written", () => {
    expect(lines("2 Wear // Tear (DGM) 135")[0]).toMatchObject({
      name: "Wear // Tear",
      set: "DGM",
    });
    expect(lines("2 Wear/Tear")[0]?.name).toBe("Wear/Tear");
    expect(lines("2 Wear / Tear")[0]?.name).toBe("Wear / Tear");
  });

  it("reads a Magic Workstation hint", () => {
    expect(lines("4 [M11] Lightning Bolt")[0]).toMatchObject({
      hint: "M11",
      name: "Lightning Bolt",
    });
    expect(lines("4 [] Lightning Bolt")[0]).toEqual({
      n: 1,
      c: 4,
      name: "Lightning Bolt",
      s: "main",
    });
    expect(lines("4 [9e] Blood Moon")[0]?.hint).toBe("9e");
    expect(lines("4 [ABCDEF]\tName")[0]?.hint).toBe("ABCDEF");
  });

  it("gives E-PARSE-LINE for a hint and a trailing set code together", () => {
    expect(errors("4 [M11] Lightning Bolt (M11) 149")).toEqual([
      "E-PARSE-LINE@1",
    ]);
    expect(errors("4 [] Lightning Bolt (M11)")).toEqual(["E-PARSE-LINE@1"]);
  });

  it("does not take a bracket that is not a hint for one", () => {
    expect(lines("4 [ABCDEFG] Name")[0]?.name).toBe("[ABCDEFG] Name");
    expect(lines("4 [a b] Name")[0]?.name).toBe("[a b] Name");
    expect(lines("4 [M11]Name")[0]?.name).toBe("[M11]Name");
  });

  it("takes a bracket with nothing after it for the name", () => {
    expect(lines("4 []")[0]?.name).toBe("[]");
    expect(lines("4 [M11]   ")[0]?.name).toBe("[M11]");
  });

  it("describes the problem", () => {
    expect(parseCardLine("four A")).toContain("count");
    expect(parseCardLine("1 A (SET) 1 2")).toContain("collector number");
    expect(parseCardLine("1 [] A (SET)")).toContain("both");
    expect(parseCardLine("1 [M11] ")).toContain("empty");
  });
});

describe("comments, blanks and headers", () => {
  it("ignores comments with // or #, also with leading whitespace", () => {
    expect(lines("// a\n# b\n  // c\n\t# d\n4 Bolt\n// NAME : Burn")).toEqual([
      { n: 5, c: 4, name: "Bolt", s: "main" },
    ]);
  });

  it("treats headers case-insensitively, with an optional colon", () => {
    const text =
      "Deck\n1 A\nMAINBOARD:\n1 B\nmain\n1 C\nSideboard\n1 D\nSIDEBOARD:\n1 E\nCompanion\n1 F\nDeck:\n1 G\n";
    expect(lines(text).map((l) => `${l.name}:${l.s}`)).toEqual([
      "A:main",
      "B:main",
      "C:main",
      "D:sideboard",
      "E:sideboard",
      "F:sideboard",
      "G:main",
    ]);
  });

  it("does not take text around a header word for a header", () => {
    expect(errors("Sideboard cards")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("Sideboard :")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("constructor")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("__proto__")).toEqual(["E-PARSE-LINE@1"]);
  });

  it("adds to the same section when a header repeats", () => {
    expect(
      lines("Sideboard\n1 A\nDeck\n1 B\nSideboard\n1 C\n").map((l) => l.s),
    ).toEqual(["sideboard", "main", "sideboard"]);
  });

  it("reads a Commander section, notes its header, and keeps its cards apart", () => {
    const d = parseDeck(
      "Commander\n1 Tarmogoyf\nDeck\n4 Bolt\nCOMMANDER:\n1 X\n",
      "a.txt",
    );
    expect(d.commanderHeaderLines).toEqual([1, 5]);
    expect(d.lines.map((l) => l.section)).toEqual([
      "commander",
      "main",
      "commander",
    ]);
    expect(d.parseErrors).toEqual([]);
  });
});

describe("the sideboard", () => {
  it("starts at the first blank line after a card line when no header was seen", () => {
    expect(lines("4 A\n4 B\n\n2 C\n\n1 D\n").map((l) => l.s)).toEqual([
      "main",
      "main",
      "sideboard",
      "sideboard",
    ]);
  });

  it("ignores blank lines before the first card, and after a header", () => {
    expect(lines("\n\n4 A\n").map((l) => l.s)).toEqual(["main"]);
    expect(
      lines("Deck\n4 A\n\n4 B\nSideboard\n\n2 C\n").map((l) => l.s),
    ).toEqual(["main", "main", "sideboard"]);
    // A header before the blank line also stops the blank-line rule.
    expect(lines("Deck\n4 A\n\n4 B\n").map((l) => l.s)).toEqual([
      "main",
      "main",
    ]);
  });

  it("lets a later header set the section as usual", () => {
    expect(lines("4 A\n\n2 B\nDeck\n1 C\n").map((l) => l.s)).toEqual([
      "main",
      "sideboard",
      "main",
    ]);
  });

  it("does not let an SB: line start the blank-line sideboard", () => {
    expect(lines("SB: 1 A\n\n4 B\n").map((l) => l.s)).toEqual([
      "sideboard",
      "main",
    ]);
  });

  it("puts an SB: line in the sideboard, in any case, with any whitespace after SB:", () => {
    const l = lines(
      "SB: 1 A\nsb:\t2 B\nSb:   3 C (M11) 4\nSB:  2 [] Wear / Tear\n",
    );
    expect(l.map((x) => `${x.c}:${x.name}:${x.s}`)).toEqual([
      "1:A:sideboard",
      "2:B:sideboard",
      "3:C:sideboard",
      "2:Wear / Tear:sideboard",
    ]);
  });

  it("does not change the current section on an SB: line", () => {
    expect(lines("Deck\nSB: 1 A\n4 B\n").map((x) => x.s)).toEqual([
      "sideboard",
      "main",
    ]);
    expect(lines("Commander\nSB: 1 A\n1 B\n").map((x) => x.s)).toEqual([
      "sideboard",
      "commander",
    ]);
  });

  it("gives E-PARSE-LINE for SB: without whitespace or without a card line", () => {
    expect(errors("SB:1 A")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("SB:")).toEqual(["E-PARSE-LINE@1"]);
    expect(errors("SB: nope")).toEqual(["E-PARSE-LINE@1"]);
  });
});

describe("encoding and line endings", () => {
  it("reads CRLF and LF, with or without a final newline", () => {
    expect(lines("4 A\r\n4 B\r\n").map((l) => l.name)).toEqual(["A", "B"]);
    expect(lines("4 A\r\nSideboard\r\n1 B").map((l) => l.s)).toEqual([
      "main",
      "sideboard",
    ]);
  });

  it("does not take a lone CR for a line ending", () => {
    const l = lines("4 A\r5 B\n");
    expect(l).toHaveLength(1);
    expect(l[0]?.name).toBe("A\r5 B");
  });

  it("removes a byte order mark, in text and in bytes", () => {
    expect(lines("﻿4 A\n")[0]?.name).toBe("A");
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("4 A\n"),
    ]);
    expect(parseDeck(bytes, "a.txt").lines[0]?.rawName).toBe("A");
  });

  it("gives E-PARSE-LINE for a line that is not valid UTF-8, and goes on", () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("4 A\n4 "),
      0xe9,
      ...new TextEncoder().encode("B\n4 C\n"),
    ]);
    const d = parseDeck(bytes, "a.txt");
    expect(d.parseErrors.map((v) => `${v.code}@${v.line}`)).toEqual([
      "E-PARSE-LINE@2",
    ]);
    expect(d.lines.map((l) => l.rawName)).toEqual(["A", "C"]);
  });

  it("reads non-ASCII names from bytes", () => {
    const d = parseDeck(new TextEncoder().encode("1 Jötun Grunt\r\n"), "a.txt");
    expect(d.lines[0]?.rawName).toBe("Jötun Grunt");
  });
});

describe("limits", () => {
  it("allows a card line of 300 characters and refuses 301", () => {
    const name = (n: number): string => "x".repeat(n - 2); // "1 " is 2 characters
    expect(errors(`1 ${name(300)}\n`)).toEqual([]);
    expect(errors(`1 ${name(301)}\n`)).toEqual(["E-LIMIT-EXCEEDED@1"]);
    expect(lines(`1 ${name(301)}\n2 B\n`).map((l) => l.n)).toEqual([2]);
  });

  it("counts the SB: prefix, and code points rather than UTF-16 units", () => {
    expect(errors(`SB: 1 ${"x".repeat(300 - 6)}`)).toEqual([]);
    expect(errors(`SB: 1 ${"x".repeat(300 - 5)}`)).toEqual([
      "E-LIMIT-EXCEEDED@1",
    ]);
    expect(errors(`1 ${"\u{1F600}".repeat(298)}`)).toEqual([]);
    expect(errors(`1 ${"\u{1F600}".repeat(299)}`)).toEqual([
      "E-LIMIT-EXCEEDED@1",
    ]);
  });

  it("does not apply the line length limit to comments", () => {
    expect(errors(`// ${"x".repeat(1000)}\n`)).toEqual([]);
  });

  it("allows 250 card lines and gives E-LIMIT-EXCEEDED once for more", () => {
    const make = (n: number): string =>
      Array.from({ length: n }, (_, i) => `1 Card ${i}`).join("\n");
    expect(errors(make(250))).toEqual([]);
    const d = parseDeck(make(300), "a.txt");
    expect(d.parseErrors.map((v) => `${v.code}@${v.line}`)).toEqual([
      "E-LIMIT-EXCEEDED@251",
    ]);
    expect(d.lines).toHaveLength(250);
  });

  it("counts SB: lines, but not comments, headers and blank lines", () => {
    const body = Array.from({ length: 125 }, (_, i) => `1 Main ${i}`).join(
      "\n",
    );
    const side = Array.from({ length: 125 }, (_, i) => `SB: 1 Side ${i}`).join(
      "\n",
    );
    expect(errors(`// c\nDeck\n\n${body}\n${side}\n`)).toEqual([]);
    expect(errors(`${body}\n${side}\nSB: 1 More\n`)).toEqual([
      "E-LIMIT-EXCEEDED@251",
    ]);
  });

  it("refuses a file over 256 KB", () => {
    const d = parseDeck(`// ${"x".repeat(256 * 1024)}\n4 A\n`, "a.txt");
    expect(d.parseErrors.map((v) => v.code)).toEqual(["E-LIMIT-EXCEEDED"]);
    expect(d.lines).toEqual([]);
    const bytes = new Uint8Array(256 * 1024 + 1).fill(0x61);
    expect(parseDeck(bytes, "a.txt").parseErrors[0]?.code).toBe(
      "E-LIMIT-EXCEEDED",
    );
  });

  it("takes linear time on hostile input", () => {
    const hostile = [
      `1 ${" ".repeat(250_000)}x`,
      `1 ${"( ".repeat(100_000)}`,
      `1 ${"a (SET) ".repeat(30_000)}`,
      `${" \t".repeat(100_000)}x`,
    ];
    const start = performance.now();
    for (const h of hostile) parseDeck(h, "a.txt");
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("reports a parse error on line numbers counted from the first line", () => {
    expect(errors("---\nname: x\n---\n// c\nbad line\n")).toEqual([
      "E-PARSE-LINE@5",
    ]);
  });
});

describe("the mtgtop8 layout samples", () => {
  const dir = `${repoRoot}conformance/layout-samples/mtgtop8/`;
  const files = readdirSync(dir);

  it("has the nine samples", () => {
    expect(files).toHaveLength(9);
  });

  for (const f of readdirSync(dir)) {
    it(`parses ${f} without errors`, () => {
      const d = parseDeck(new Uint8Array(readFileSync(dir + f)), f);
      expect(d.parseErrors).toEqual([]);
      expect(d.warnings).toEqual([]);
      const main = d.lines.filter((l) => l.section === "main");
      const side = d.lines.filter((l) => l.section === "sideboard");
      expect(main.length).toBeGreaterThan(15);
      expect(side.length).toBeGreaterThanOrEqual(6);
      expect(
        main.every((l) => l.rawName !== "" && !l.rawName.startsWith("[")),
      ).toBe(true);
      if (f.endsWith(".dec"))
        expect(d.lines.some((l) => l.hint !== undefined)).toBe(true);
      if (f.endsWith(".mtga.txt"))
        expect(d.lines.every((l) => l.set !== undefined)).toBe(true);
    });
  }

  it("reads Wear / Tear and Wear/Tear as written, and the SB: lines of a .dec file", () => {
    const dec = parseDeck(readFileSync(`${dir}910599.dec`), "x");
    expect(dec.lines.find((l) => l.rawName.startsWith("Wear"))).toMatchObject({
      rawName: "Wear / Tear",
      hint: "DGM",
      count: 2,
      section: "sideboard",
    });
    expect(dec.lines.filter((l) => l.section === "sideboard")).toHaveLength(8);
    const mtgo = parseDeck(readFileSync(`${dir}910599.mtgo.txt`), "x");
    expect(mtgo.lines.find((l) => l.rawName.startsWith("Wear"))?.rawName).toBe(
      "Wear/Tear",
    );
    const mtga = parseDeck(readFileSync(`${dir}910599.mtga.txt`), "x");
    expect(mtga.lines.find((l) => l.rawName.startsWith("Wear"))).toMatchObject({
      rawName: "Wear // Tear",
      set: "PIO",
      number: "398",
    });
  });
});
