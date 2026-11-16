import { describe, expect, it } from "vitest";
import { canonicalJson, formatKey, parseFormatDef } from "../src/index.js";
import { parseDef, read } from "./helpers.js";

const base = `schema_version: 1
id: tiny
name: Tiny
legality_by: name
sets: [M15, KTK]
banned: [Ponder, Preordain]
restricted: [Brainstorm]
include:
  - name: Tarmogoyf
    reason: because
  - name: Black Lotus
    reason: also
exclude:
  - name: Mox Opal
    reason: no
deck:
  min_main: 40
  max_copies: 3
`;

const key = (yaml: string): Promise<string> =>
  formatKey("repo:formats/tiny.yaml", parseDef(yaml));

describe("canonicalJson", () => {
  it("sorts keys, writes no whitespace and uses ECMAScript numbers", () => {
    expect(
      canonicalJson({
        b: 1,
        a: [true, null, "x"],
        c: { z: 1.5, y: 1e21, x: -0 },
      }),
    ).toBe('{"a":[true,null,"x"],"b":1,"c":{"x":0,"y":1e+21,"z":1.5}}');
  });

  it("matches the example in RFC 8785, section 3.2.4 (sorting)", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    const text = canonicalJson(input);
    const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)":/g)].map(
      (m) => JSON.parse(`"${m[1] ?? ""}"`) as string,
    );
    expect(keys).toEqual(["\r", "1", "\u0080", "ö", "€", "😀", "דּ"]);
  });

  it("writes numbers and strings in ECMAScript form", () => {
    expect(
      canonicalJson(JSON.parse("[333333333.33333329, 1e30, 4.5, 2e-3, 1e-27]")),
    ).toBe("[333333333.3333333,1e+30,4.5,0.002,1e-27]");
    expect(canonicalJson({ s: 'a"b\\c\n\u000f/\u20ac' })).toBe(
      '{"s":"a\\"b\\\\c\\n\\u000f/\u20ac"}',
    );
  });

  it("leaves out undefined members and refuses what JSON cannot hold", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Infinity)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });
});

describe("formatKey", () => {
  it("is <ref>#<12 hex characters>", async () => {
    expect(await key(base)).toMatch(/^repo:formats\/tiny\.yaml#[0-9a-f]{12}$/);
  });

  it("ends in #mtgjson for an official format", async () => {
    expect(await formatKey("official:modern", null)).toBe(
      "official:modern#mtgjson",
    );
  });

  it("does not change when keys are reordered", async () => {
    const lines = base.split("\n");
    const reordered = [
      "name: Tiny",
      "sets: [M15, KTK]",
      "legality_by: name",
      "id: tiny",
      "schema_version: 1",
      ...lines.slice(5),
    ].join("\n");
    expect(await key(reordered)).toBe(await key(base));
  });

  it("does not change when lists are reordered", async () => {
    const other = base
      .replace("sets: [M15, KTK]", "sets: [KTK, M15]")
      .replace("banned: [Ponder, Preordain]", "banned: [Preordain, Ponder]")
      .replace(
        "  - name: Tarmogoyf\n    reason: because\n  - name: Black Lotus\n    reason: also\n",
        "  - name: Black Lotus\n    reason: also\n  - name: Tarmogoyf\n    reason: because\n",
      );
    expect(other).not.toBe(base);
    expect(await key(other)).toBe(await key(base));
  });

  it("does not change with a reason or a comment, or with an explicit default", async () => {
    const k = await key(base);
    expect(
      await key(base.replaceAll("reason: no", "reason: other words")),
    ).toBe(k);
    expect(await key(`# a comment\n${base}`)).toBe(k);
    const noDeck =
      "schema_version: 1\nid: d\nname: D\nlegality_by: name\nsets: [M15]\n";
    const explicit = `${noDeck}deck:\n  min_main: 60\n  max_sideboard: 15\n  max_copies: 4\n  copy_exempt: [any_number_text, basic_lands]\n`;
    expect(await key(explicit)).toBe(await key(noDeck));
  });

  it("changes when a banlist changes", async () => {
    const k = await key(base);
    expect(await key(base.replace("[Ponder, Preordain]", "[Ponder]"))).not.toBe(
      k,
    );
    expect(
      await key(
        base.replace(
          "[Ponder, Preordain]",
          "[Ponder, Preordain, Treasure Cruise]",
        ),
      ),
    ).not.toBe(k);
    expect(
      await key(base.replace("[Ponder, Preordain]", "[Ponder, preordain]")),
    ).not.toBe(k);
  });

  it("changes with the sets, the restricted list, the overrides and the deck rules", async () => {
    const k = await key(base);
    for (const [from, to] of [
      ["[M15, KTK]", "[M15, KTK, FRF]"],
      ["[Brainstorm]", "[Brainstorm, Ponder]"],
      ["name: Tarmogoyf", "name: Tarmogoyf2"],
      ["name: Mox Opal", "name: Mox Pearl"],
      ["min_main: 40", "min_main: 41"],
      ["max_copies: 3", "max_copies: 4"],
      ["name: Tiny", "name: Tiny 2"],
      ["id: tiny", "id: tiny2"],
      ["  max_copies: 3", "  max_copies: 3\n  max_main: 100"],
      ["  max_copies: 3", "  max_copies: 3\n  copy_exempt: [basic_lands]"],
    ] as const) {
      expect(await key(base.replace(from, to)), from).not.toBe(k);
    }
  });

  it("keeps a different key for a different reference", async () => {
    const def = parseDef(base);
    expect(await formatKey("repo:formats/a.yaml", def)).not.toBe(
      await formatKey("repo:formats/b.yaml", def),
    );
  });

  it("gives the 2015 Modern preset a stable key", async () => {
    const r = parseFormatDef(
      read("presets/2015-modern@1.yaml"),
      "presets/2015-modern@1.yaml",
    );
    expect(r.violations).toEqual([]);
    const k = await formatKey("preset:2015-modern@1", r.def);
    // If this changes, every cached pool of this preset is rebuilt. Change it only
    // for a new revision of the format-key rules.
    expect(k).toBe("preset:2015-modern@1#d0ef0b4ed38d");
  });
});
