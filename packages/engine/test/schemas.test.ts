import { describe, expect, it } from "vitest";
import {
  checkFormatDef,
  parseFormatDef,
  parseFormatRef,
  parseGauntlet,
  officialRules,
  mapMtgjsonLegality,
  isOfficialFormatName,
  legalityColumn,
} from "../src/index.js";
import { lookup, parseDef, read } from "./helpers.js";

const codes = (vs: { code: string; line?: number }[]): string[] =>
  vs.map((v) => `${v.code}@${v.line ?? "-"}`);

describe("parseGauntlet", () => {
  it("reads a gauntlet and fills in schema_version", () => {
    const r = parseGauntlet(
      "name: Test\nformat: preset:2015-modern@1\ndescription: d\n",
    );
    expect(r.violations).toEqual([]);
    expect(r.def).toEqual({
      schema_version: 1,
      name: "Test",
      format: "preset:2015-modern@1",
      description: "d",
    });
  });

  it("reads schema_version when given", () => {
    expect(
      parseGauntlet("schema_version: 1\nname: T\nformat: modern\n").def
        ?.schema_version,
    ).toBe(1);
  });

  it("gives E-SCHEMA-VERSION before checking the rest", () => {
    const r = parseGauntlet("schema_version: 2\nname: ''\nformat: nope\n");
    expect(codes(r.violations)).toEqual(["E-SCHEMA-VERSION@1"]);
    expect(r.def).toBeNull();
  });

  it("gives E-SCHEMA-INVALID for unknown and missing fields and bad formats", () => {
    expect(
      codes(parseGauntlet("name: T\nformat: modern\nextra: 1\n").violations),
    ).toEqual(["E-SCHEMA-INVALID@3"]);
    expect(codes(parseGauntlet("name: T\n").violations)).toEqual([
      "E-SCHEMA-INVALID@1",
    ]);
    expect(
      codes(parseGauntlet("name: T\nformat: commander\n").violations),
    ).toEqual(["E-SCHEMA-INVALID@2"]);
    expect(codes(parseGauntlet("").violations)).toEqual(["E-SCHEMA-INVALID@1"]);
    expect(codes(parseGauntlet("- a\n").violations)).toEqual([
      "E-SCHEMA-INVALID@1",
    ]);
  });

  it("gives E-SCHEMA-INVALID for a YAML error, and E-LIMIT-EXCEEDED for a limit", () => {
    expect(codes(parseGauntlet("name: [\n").violations)[0]).toMatch(
      /^E-SCHEMA-INVALID@/,
    );
    expect(codes(parseGauntlet("name: &a x\nformat: *a\n").violations)[0]).toBe(
      "E-SCHEMA-INVALID@1",
    );
    expect(
      codes(parseGauntlet(`name: ${"x".repeat(70000)}\n`).violations),
    ).toEqual(["E-LIMIT-EXCEEDED@1"]);
  });

  it("explains each error", () => {
    const msgs = parseGauntlet(
      "name: ''\nformat: x\nextra: 1\ndescription: 5\n",
    ).violations.map((v) => v.message);
    expect(msgs.join("|")).toContain('Unknown field "extra"');
    expect(msgs.some((m) => m.includes("/name"))).toBe(true);
    expect(parseGauntlet("format: modern\n").violations[0]?.message).toContain(
      'Missing required field "name"',
    );
    expect(
      parseDefViolations(
        "schema_version: 1\nid: a\nname: b\nlegality_by: x\nsets: [M15]\n",
      )[0],
    ).toContain("must be one of");
  });
});

function parseDefViolations(yaml: string): string[] {
  return parseFormatDef(yaml, "f.yaml").violations.map((v) => v.message);
}

describe("parseFormatRef", () => {
  it("normalises the four forms", () => {
    expect(parseFormatRef("preset:2015-modern@1")).toEqual({
      kind: "preset",
      ref: "preset:2015-modern@1",
      id: "2015-modern",
      revision: 1,
    });
    expect(parseFormatRef("repo:formats/cube.yaml")).toEqual({
      kind: "repo",
      ref: "repo:formats/cube.yaml",
      path: "formats/cube.yaml",
    });
    expect(parseFormatRef("official:modern")).toEqual({
      kind: "official",
      ref: "official:modern",
      name: "modern",
    });
    expect(parseFormatRef("modern")).toEqual({
      kind: "official",
      ref: "official:modern",
      name: "modern",
    });
  });

  it("returns null for anything else", () => {
    for (const bad of [
      "",
      "commander",
      "official:commander",
      "preset:x",
      "repo:cube.yaml",
      "repo:formats/a/b.yaml",
    ]) {
      expect(parseFormatRef(bad), bad).toBeNull();
    }
  });
});

describe("parseFormatDef", () => {
  const minimal =
    "schema_version: 1\nid: a\nname: A\nlegality_by: name\nsets: [M15, KTK]\n";

  it("fills in defaults", () => {
    const r = parseFormatDef(minimal, "f.yaml");
    expect(r.violations).toEqual([]);
    expect(r.def).toEqual({
      schema_version: 1,
      id: "a",
      name: "A",
      legality_by: "name",
      sets: ["M15", "KTK"],
      banned: [],
      restricted: [],
      include: [],
      exclude: [],
      deck: {
        min_main: 60,
        max_sideboard: 15,
        max_copies: 4,
        copy_exempt: ["basic_lands", "any_number_text"],
      },
    });
  });

  it("keeps max_main only when given, and keeps what is given", () => {
    const r = parseFormatDef(
      `${minimal}deck:\n  max_main: 99\n  copy_exempt: []\n  min_main: 0\n`,
      "f.yaml",
    );
    expect(r.def?.deck).toEqual({
      min_main: 0,
      max_main: 99,
      max_sideboard: 15,
      max_copies: 4,
      copy_exempt: [],
    });
  });

  it("requires schema_version", () => {
    const r = parseFormatDef(
      "id: a\nname: A\nlegality_by: name\nsets: [M15]\n",
      "f.yaml",
    );
    expect(codes(r.violations)).toEqual(["E-SCHEMA-INVALID@1"]);
  });

  it("reports schema errors on the line of the key", () => {
    const r = parseFormatDef(
      `${minimal}banned: [A, A]\ninclude:\n  - name: X\nsets2: 1\ndeck:\n  min_main: 300\n  other: 1\n`,
      "f.yaml",
    );
    expect(codes(r.violations)).toEqual([
      "E-SCHEMA-INVALID@6",
      "E-SCHEMA-INVALID@8",
      "E-SCHEMA-INVALID@9",
      "E-SCHEMA-INVALID@11",
      "E-SCHEMA-INVALID@12",
    ]);
    expect(r.def).toBeNull();
  });

  it("checks set codes, sizes and unique items", () => {
    expect(
      codes(
        parseFormatDef(minimal.replace("[M15, KTK]", "[m15]"), "f").violations,
      ),
    ).toEqual(["E-SCHEMA-INVALID@5"]);
    expect(
      codes(
        parseFormatDef(minimal.replace("[M15, KTK]", "[]"), "f").violations,
      ),
    ).toEqual(["E-SCHEMA-INVALID@5"]);
    expect(
      codes(
        parseFormatDef(minimal.replace("[M15, KTK]", "[M15, M15]"), "f")
          .violations,
      ),
    ).toEqual(["E-SCHEMA-INVALID@5"]);
  });
});

describe("checkFormatDef", () => {
  const mk = (extra: string): ReturnType<typeof parseDef> =>
    parseDef(
      `schema_version: 1\nid: a\nname: A\nlegality_by: name\nsets: [M15]\n${extra}`,
    );

  it("accepts a definition whose names are cards", () => {
    const def = mk(
      "banned: [Lightning Bolt]\nrestricted: [Wear/Tear]\ninclude:\n  - {name: Delver of Secrets, reason: r}\nexclude:\n  - {name: Tarmogoyf, reason: r}\n",
    );
    expect(checkFormatDef(def, { file: "f", expectedId: "a", lookup })).toEqual(
      [],
    );
  });

  it("gives E-FORMAT-INVALID for an id that does not match the reference", () => {
    const v = checkFormatDef(mk(""), { file: "f", expectedId: "b", lookup });
    expect(v.map((x) => x.code)).toEqual(["E-FORMAT-INVALID"]);
    expect(v[0]?.message).toContain('"a"');
  });

  it("gives E-FORMAT-INVALID when max_main is smaller than min_main", () => {
    const v = checkFormatDef(mk("deck:\n  min_main: 60\n  max_main: 59\n"), {
      file: "f",
      lookup,
    });
    expect(v.map((x) => x.code)).toEqual(["E-FORMAT-INVALID"]);
    expect(
      checkFormatDef(mk("deck:\n  min_main: 60\n  max_main: 60\n"), {
        file: "f",
        lookup,
      }),
    ).toEqual([]);
  });

  it("gives E-FORMAT-INVALID for a name that is not a card, in each list", () => {
    const def = mk(
      "banned: [Nope One]\nrestricted: [Nope Two]\ninclude:\n  - {name: Nope Three, reason: r}\nexclude:\n  - {name: Nope Four, reason: r}\n",
    );
    const v = checkFormatDef(def, { file: "f", lookup });
    expect(v.map((x) => x.message)).toEqual([
      '"Nope One" in banned is not a card',
      '"Nope Two" in restricted is not a card',
      '"Nope Three" in include is not a card',
      '"Nope Four" in exclude is not a card',
    ]);
  });

  it("does not take a back-face name for a card", () => {
    const def = mk("banned: [Insectile Aberration]\n");
    expect(checkFormatDef(def, { file: "f", lookup })).toHaveLength(1);
  });

  it("validates the 2015 Modern preset", () => {
    const r = parseFormatDef(
      read("presets/2015-modern@1.yaml"),
      "presets/2015-modern@1.yaml",
    );
    expect(r.violations).toEqual([]);
    expect(r.def?.id).toBe("2015-modern");
    expect(r.def?.sets).toHaveLength(49);
    expect(r.def?.banned).toHaveLength(32);
    expect(r.def).not.toBeNull();
    if (r.def) {
      expect(
        checkFormatDef(r.def, { file: "p", expectedId: "2015-modern", lookup }),
      ).toEqual([]);
      const wrong = checkFormatDef(r.def, {
        file: "p",
        expectedId: "2016-modern",
        lookup,
      });
      expect(wrong.map((v) => v.code)).toEqual(["E-FORMAT-INVALID"]);
    }
  });
});

describe("official formats", () => {
  it("has the deck rules of the spec", () => {
    for (const n of [
      "standard",
      "pioneer",
      "modern",
      "legacy",
      "vintage",
      "pauper",
    ] as const) {
      expect(isOfficialFormatName(n)).toBe(true);
      expect(officialRules(n)).toEqual({
        official: n,
        name: n.charAt(0).toUpperCase() + n.slice(1),
        deck: {
          min_main: 60,
          max_sideboard: 15,
          max_copies: 4,
          copy_exempt: ["basic_lands", "any_number_text"],
        },
      });
      expect(legalityColumn(n)).toBe(n);
    }
    expect(isOfficialFormatName("commander")).toBe(false);
  });

  it("maps MTGJSON legality values", () => {
    expect(mapMtgjsonLegality("Legal")).toBe("legal");
    expect(mapMtgjsonLegality("Restricted")).toBe("restricted");
    expect(mapMtgjsonLegality("Banned")).toBe("banned");
    expect(mapMtgjsonLegality("Not Legal")).toBe("not_legal");
    expect(mapMtgjsonLegality(null)).toBe("not_legal");
    expect(mapMtgjsonLegality(undefined)).toBe("not_legal");
    expect(mapMtgjsonLegality("Suspended")).toBe("not_legal");
  });
});
