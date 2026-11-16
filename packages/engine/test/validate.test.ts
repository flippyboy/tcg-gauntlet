import { describe, expect, it } from "vitest";
import {
  type CardLookup,
  type FormatDef,
  type OfficialFormatName,
  cardMatchesName,
  checkDeck,
  formatKey,
  officialRules,
  parseFormatDef,
  resolveDeck,
  validateDeck,
} from "../src/index.js";
import {
  deck,
  lookup,
  parseDef,
  read,
  registered,
  row,
  synthetic,
  tinyFormat,
} from "./helpers.js";

async function run(
  text: string,
  def: FormatDef,
  l: CardLookup = lookup,
): Promise<string[]> {
  const key = await formatKey("repo:formats/t.yaml", def);
  l.registerFormat?.(key, def);
  return checkDeck(deck(text), def, key, l).violations.map(
    (v) => `${v.code}@${v.line ?? "-"}`,
  );
}

/** Pads a deck to 60 main cards with basic lands, so that only the tested rule fails. */
const pad = (text: string, have: number): string =>
  `${text}\n${60 - have} Mountain\n`;

const preset = (() => {
  const r = parseFormatDef(read("presets/2015-modern@1.yaml"), "p");
  if (!r.def) throw new Error("preset");
  return r.def;
})();

describe("custom formats: legality", () => {
  it("accepts cards in the pool", async () => {
    expect(await run(pad("4 Lightning Bolt", 4), tinyFormat())).toEqual([]);
  });

  it("gives E-LEGAL-BANNED on each line of a banned card", async () => {
    const def = tinyFormat("banned: [Lightning Bolt]\n");
    expect(
      await run(pad("2 Lightning Bolt\n1 Mountain\n2 Lightning Bolt", 5), def),
    ).toEqual(["E-LEGAL-BANNED@1", "E-LEGAL-BANNED@3"]);
  });

  it("matches a banned name by front face, split spelling and accents", async () => {
    const dfc = tinyFormat("banned: [Delver of Secrets]\n", "[ISD, M10]");
    expect(await run(pad("1 Delver of Secrets", 1), dfc)).toEqual([
      "E-LEGAL-BANNED@1",
    ]);
    const split = tinyFormat("banned: [Wear/Tear]\n", "[DGM, M10]");
    expect(await run(pad("1 Wear // Tear", 1), split)).toEqual([
      "E-LEGAL-BANNED@1",
    ]);
    const accent = tinyFormat("banned: [Jotun Grunt]\n", "[ICE, M10]");
    expect(await run(pad("1 Jötun Grunt", 1), accent)).toEqual([
      "E-LEGAL-BANNED@1",
    ]);
  });

  it("gives E-LEGAL-NOT-IN-POOL for a card with no printing in the listed sets", async () => {
    expect(await run(pad("4 Tarmogoyf", 4), tinyFormat())).toEqual([
      "E-LEGAL-NOT-IN-POOL@1",
    ]);
  });

  it("puts a card in the pool with include, and keeps banned and exclude stronger", async () => {
    const inc = "include:\n  - {name: Tarmogoyf, reason: r}\n";
    expect(await run(pad("4 Tarmogoyf", 4), tinyFormat(inc))).toEqual([]);
    expect(
      await run(
        pad("4 Tarmogoyf", 4),
        tinyFormat(`${inc}banned: [Tarmogoyf]\n`),
      ),
    ).toEqual(["E-LEGAL-BANNED@1"]);
    expect(
      await run(
        pad("4 Tarmogoyf", 4),
        tinyFormat(`${inc}exclude:\n  - {name: Tarmogoyf, reason: r}\n`),
      ),
    ).toEqual(["E-LEGAL-NOT-IN-POOL@1"]);
  });

  it("takes a card out of the pool with exclude", async () => {
    const def = tinyFormat("exclude:\n  - {name: Lightning Bolt, reason: r}\n");
    expect(await run(pad("4 Lightning Bolt", 4), def)).toEqual([
      "E-LEGAL-NOT-IN-POOL@1",
    ]);
  });

  it("ignores funny, online-only and oversized printings, and promo sets that are not listed", async () => {
    const l = synthetic(
      [
        row({ name: "Only Funny", setCode: "AAA", isFunny: 1 }),
        row({ name: "Only Online", setCode: "AAA", isOnlineOnly: 1 }),
        row({ name: "Only Big", setCode: "AAA", isOversized: 1 }),
        row({ name: "Promo", setCode: "PRM", isPromo: 1 }),
        row({ name: "Normal", setCode: "AAA" }),
        row({ name: "Mixed", setCode: "AAA", isFunny: 1 }),
        row({ name: "Mixed", setCode: "AAA", number: "2", isFunny: null }),
      ],
      [
        { code: "AAA", releaseDate: "2000-01-01", type: "core" },
        { code: "PRM", releaseDate: "2000-01-01", type: "promo" },
      ],
    );
    const def = tinyFormat("", "[AAA]");
    const key = await registered(def);
    l.registerFormat(key, def);
    const pool = [
      "Only Funny",
      "Only Online",
      "Only Big",
      "Promo",
      "Normal",
      "Mixed",
    ].map((n) => `${n}:${String(l.inPool(key, l.findCard(n)!))}`);
    expect(pool).toEqual([
      "Only Funny:false",
      "Only Online:false",
      "Only Big:false",
      "Promo:false",
      "Normal:true",
      "Mixed:true",
    ]);
  });

  it("does not check legality of unknown cards", async () => {
    expect(await run(pad("4 Nonsense Card", 4), tinyFormat())).toEqual([
      "E-CARD-UNKNOWN@1",
    ]);
  });
});

describe("custom formats: restricted", () => {
  const def = tinyFormat("restricted: [Lightning Bolt]\n");

  it("allows one copy and gives E-LEGAL-RESTRICTED on the first line for more", async () => {
    expect(await run(pad("1 Lightning Bolt", 1), def)).toEqual([]);
    expect(
      await run(pad("1 Lightning Bolt\n1 Mountain\n1 Lightning Bolt", 3), def),
    ).toEqual(["E-LEGAL-RESTRICTED@1"]);
  });

  it("counts main deck and sideboard together", async () => {
    expect(
      await run(
        "1 Lightning Bolt\n58 Mountain\n1 Dismember\nSideboard\n1 Lightning Bolt\n",
        def,
      ),
    ).toEqual(["E-LEGAL-RESTRICTED@1"]);
  });

  it("does not report a restricted card that is banned or not in the pool as restricted", async () => {
    const banned = tinyFormat(
      "restricted: [Lightning Bolt]\nbanned: [Lightning Bolt]\n",
    );
    expect(await run(pad("2 Lightning Bolt", 2), banned)).toEqual([
      "E-LEGAL-BANNED@1",
    ]);
    const out = tinyFormat("restricted: [Tarmogoyf]\n");
    expect(await run(pad("2 Tarmogoyf", 2), out)).toEqual([
      "E-LEGAL-NOT-IN-POOL@1",
    ]);
  });

  it("does not exempt a restricted card from the restriction, even a basic land", async () => {
    const d = tinyFormat("restricted: [Mountain]\n");
    expect(await run("2 Mountain\n58 Swamp\n", d)).toEqual([
      "E-LEGAL-RESTRICTED@1",
    ]);
  });
});

describe("copies", () => {
  it("counts main deck and sideboard together and reports the first line once", async () => {
    expect(
      await run(
        "3 Lightning Bolt\n57 Mountain\nSideboard\n2 Lightning Bolt\n",
        tinyFormat(),
      ),
    ).toEqual(["E-DECK-COPIES@1"]);
    expect(
      await run(
        "2 Lightning Bolt\n1 Lightning Bolt (M10)\n57 Mountain\nSideboard\n2 Lightning Bolt\n",
        tinyFormat(),
      ),
    ).toEqual(["E-DECK-COPIES@1"]);
  });

  it("allows exactly max_copies", async () => {
    expect(
      await run(
        "2 Lightning Bolt\n58 Mountain\nSideboard\n2 Lightning Bolt\n",
        tinyFormat(),
      ),
    ).toEqual([]);
    expect(
      await run(
        pad("3 Lightning Bolt", 3),
        tinyFormat("deck:\n  max_copies: 2\n"),
      ),
    ).toEqual(["E-DECK-COPIES@1"]);
  });

  it("exempts basic lands by default, and not with an empty copy_exempt", async () => {
    expect(await run("60 Mountain\n", tinyFormat())).toEqual([]);
    expect(
      await run("60 Mountain\n", tinyFormat("deck:\n  copy_exempt: []\n")),
    ).toEqual(["E-DECK-COPIES@1"]);
    expect(
      await run(
        "60 Mountain\n",
        tinyFormat("deck:\n  copy_exempt: [any_number_text]\n"),
      ),
    ).toEqual(["E-DECK-COPIES@1"]);
  });

  it("exempts cards whose text allows any number, such as Relentless Rats", async () => {
    const text = pad("25 Relentless Rats", 25);
    expect(await run(text, preset)).toEqual([]);
    const only = {
      ...preset,
      deck: { ...preset.deck, copy_exempt: ["basic_lands" as const] },
    };
    expect(await run(text, only)).toEqual(["E-DECK-COPIES@1"]);
  });

  it("does not exempt other cards", async () => {
    expect(await run(pad("5 Lightning Bolt", 5), preset)).toEqual([
      "E-DECK-COPIES@1",
    ]);
  });
});

describe("sizes and sections", () => {
  it("checks the main deck minimum", async () => {
    expect(await run("59 Mountain\n", tinyFormat())).toEqual([
      "E-DECK-MAIN-SIZE@-",
    ]);
    expect(await run("60 Mountain\n", tinyFormat())).toEqual([]);
    expect(await run("61 Mountain\n", tinyFormat())).toEqual([]);
    expect(
      await run("39 Mountain\n", tinyFormat("deck:\n  min_main: 40\n")),
    ).toEqual(["E-DECK-MAIN-SIZE@-"]);
    expect(await run("", tinyFormat("deck:\n  min_main: 0\n"))).toEqual([]);
  });

  it("checks the main deck maximum when there is one", async () => {
    const def = tinyFormat("deck:\n  min_main: 40\n  max_main: 40\n");
    expect(await run("40 Mountain\n", def)).toEqual([]);
    expect(await run("41 Mountain\n", def)).toEqual(["E-DECK-MAIN-SIZE@-"]);
  });

  it("sums counts over lines, and counts unknown cards", async () => {
    expect(
      await run("30 Mountain\n29 Nonsense\n1 Mountain\n", tinyFormat()),
    ).toEqual(["E-CARD-UNKNOWN@2"]);
  });

  it("checks the sideboard size, and counts Companion cards as sideboard", async () => {
    expect(
      await run("60 Mountain\nSideboard\n15 Mountain\n", tinyFormat()),
    ).toEqual([]);
    expect(
      await run("60 Mountain\nSideboard\n16 Mountain\n", tinyFormat()),
    ).toEqual(["E-DECK-SIDEBOARD-SIZE@-"]);
    expect(
      await run(
        "60 Mountain\nSideboard\n10 Mountain\nCompanion\n6 Mountain\n",
        tinyFormat(),
      ),
    ).toEqual(["E-DECK-SIDEBOARD-SIZE@-"]);
    expect(
      await run(
        "60 Mountain\nSB: 3 Mountain\n",
        tinyFormat("deck:\n  max_sideboard: 2\n"),
      ),
    ).toEqual(["E-DECK-SIDEBOARD-SIZE@-"]);
  });

  it("gives E-DECK-SECTION on each Commander header, and counts those cards nowhere", async () => {
    const text = "Commander\n1 Lightning Bolt\nDeck\n60 Mountain\nCommander:\n";
    expect(await run(text, tinyFormat())).toEqual([
      "E-DECK-SECTION@1",
      "E-DECK-SECTION@5",
    ]);
    // The commander card is not checked, counted or limited.
    expect(
      await run("Commander\n9 Tarmogoyf\nDeck\n60 Mountain\n", tinyFormat()),
    ).toEqual(["E-DECK-SECTION@1"]);
  });
});

describe("output order", () => {
  it("puts violations without a line first, then by line, then by code", async () => {
    const text = [
      "3 Lightning Bolt", // 1: copies once the sideboard adds more
      "4 Tarmogoyf", // 2: not in pool
      "2 Nonsense", // 3: unknown
      "Sideboard",
      "2 Lightning Bolt", // 5
      "Commander", // 6
    ].join("\n");
    const def = tinyFormat("restricted: [Lightning Bolt]\n");
    expect(await run(text, def)).toEqual([
      "E-DECK-MAIN-SIZE@-",
      "E-DECK-COPIES@1",
      "E-LEGAL-RESTRICTED@1",
      "E-LEGAL-NOT-IN-POOL@2",
      "E-CARD-UNKNOWN@3",
      "E-DECK-SECTION@6",
    ]);
  });

  it("has the severity of the code", () => {
    const text = "---\nx: 1\n---\n4 Lightning Bolt\n4 Tarmogoyf\n";
    const def = tinyFormat();
    lookup.registerFormat("k", def);
    const r = checkDeck(deck(text), def, "k", lookup);
    expect(r.violations.map((v) => `${v.code}:${v.severity}`)).toEqual([
      "E-DECK-MAIN-SIZE:error",
      "W-FRONTMATTER-UNKNOWN-FIELD:warning",
      "E-LEGAL-NOT-IN-POOL:error",
    ]);
  });
});

describe("official formats", () => {
  const rules = (n: OfficialFormatName = "modern") => officialRules(n);
  const key = (n: string): string => `official:${n}#mtgjson`;
  const codes = (
    text: string,
    n: OfficialFormatName = "modern",
    l: CardLookup = lookup,
  ): string[] =>
    checkDeck(deck(text), rules(n), key(n), l).violations.map(
      (v) => `${v.code}@${v.line ?? "-"}`,
    );

  it("gives E-LEGAL-BANNED for MTGJSON Banned and E-LEGAL-NOT-IN-POOL for the rest", () => {
    expect(
      codes(
        pad("4 Lightning Bolt\n4 Golgari Grave-Troll\n4 Chain Lightning", 12),
      ),
    ).toEqual(["E-LEGAL-BANNED@2", "E-LEGAL-NOT-IN-POOL@3"]);
  });

  it("judges by the card's legality over all printings", () => {
    // Black Lotus has printings with no vintage value and printings with Restricted.
    expect(codes(pad("1 Black Lotus", 1), "vintage")).toEqual([]);
    expect(codes(pad("1 Black Lotus", 1), "modern")).toEqual([
      "E-LEGAL-NOT-IN-POOL@1",
    ]);
  });

  it("limits a restricted card to one copy over main deck and sideboard", () => {
    expect(codes(pad("2 Black Lotus", 2), "vintage")).toEqual([
      "E-LEGAL-RESTRICTED@1",
    ]);
    expect(
      codes("1 Time Walk\n59 Mountain\nSideboard\n1 Time Walk\n", "vintage"),
    ).toEqual(["E-LEGAL-RESTRICTED@1"]);
  });

  it("uses the table of deck rules", () => {
    expect(codes("59 Mountain\n")).toEqual(["E-DECK-MAIN-SIZE@-"]);
    expect(codes(pad("5 Lightning Bolt", 5))).toEqual(["E-DECK-COPIES@1"]);
    expect(codes("60 Mountain\nSideboard\n16 Mountain\n", "pauper")).toEqual([
      "E-DECK-SIDEBOARD-SIZE@-",
    ]);
  });

  it("maps legality values from the printings", () => {
    const sets = [{ code: "AAA", releaseDate: "2000-01-01", type: "core" }];
    const l = synthetic(
      [
        row({ name: "A Legal", legalities: { modern: "Legal" } }),
        row({ name: "B Banned", legalities: { modern: "Banned" } }),
        row({ name: "C NotLegal", legalities: { modern: "Not Legal" } }),
        row({ name: "D Missing", legalities: {} }),
        row({ name: "E Null", legalities: { modern: null } }),
        row({ name: "F Restricted", legalities: { modern: "Restricted" } }),
        row({ name: "G Odd", legalities: { modern: "Suspended" } }),
        row({ name: "H Mixed", legalities: { modern: null } }),
        row({ name: "H Mixed", number: "2", legalities: { modern: "Legal" } }),
        row({ name: "I Mixed", legalities: { modern: "Legal" } }),
        row({ name: "I Mixed", number: "2", legalities: { modern: "Banned" } }),
        row({ name: "J Mixed", legalities: { modern: "Legal" } }),
        row({
          name: "J Mixed",
          number: "2",
          legalities: { modern: "Restricted" },
        }),
      ],
      sets,
    );
    const got = [
      "A Legal",
      "B Banned",
      "C NotLegal",
      "D Missing",
      "E Null",
      "F Restricted",
      "G Odd",
      "H Mixed",
      "I Mixed",
      "J Mixed",
    ].map((n) => l.officialLegality("modern", l.findCard(n)!));
    expect(got).toEqual([
      "legal",
      "banned",
      "not_legal",
      "not_legal",
      "not_legal",
      "restricted",
      "not_legal",
      "legal",
      "banned",
      "restricted",
    ]);
  });

  it("applies restricted to any official format whose data says so", () => {
    const l = synthetic(
      [row({ name: "Wish", legalities: { standard: "Restricted" } })],
      [{ code: "AAA", releaseDate: "2000-01-01", type: "core" }],
    );
    const v = checkDeck(
      deck("2 Wish\n58 Wish\n"),
      rules("standard"),
      key("standard"),
      l,
    ).violations;
    expect(v.map((x) => x.code)).toEqual([
      "E-DECK-COPIES",
      "E-LEGAL-RESTRICTED",
    ]);
  });
});

describe("validateDeck and cardMatchesName", () => {
  it("returns only validation violations", () => {
    const def = tinyFormat();
    const d = deck("---\nx: 1\n---\n4 Nonsense\n");
    const resolved = resolveDeck(d, "k", lookup);
    expect(validateDeck(resolved, def, "k", lookup).map((v) => v.code)).toEqual(
      ["E-DECK-MAIN-SIZE"],
    );
  });

  it("matches full names, front faces of two-face cards, and not halves of split cards", () => {
    const wear = lookup.findCard("Wear // Tear")!;
    const delver = lookup.findCard("Delver of Secrets")!;
    const bolt = lookup.findCard("Lightning Bolt")!;
    expect(cardMatchesName(wear, "wear/tear")).toBe(true);
    expect(cardMatchesName(wear, "Wear")).toBe(false);
    expect(cardMatchesName(delver, "Delver of Secrets")).toBe(true);
    expect(
      cardMatchesName(delver, "Delver of Secrets // Insectile Aberration"),
    ).toBe(true);
    expect(cardMatchesName(delver, "Insectile Aberration")).toBe(false);
    expect(cardMatchesName(bolt, "Lightning Bolt")).toBe(true);
    expect(cardMatchesName(bolt, "Bolt")).toBe(false);
  });

  it("accepts the 2015 Modern preset's own banned list as banned", async () => {
    const text = pad(preset.banned.map((n) => `1 ${n}`).join("\n"), 32);
    const v = await run(text, preset);
    expect(v).toHaveLength(32);
    expect(v.every((x) => x.startsWith("E-LEGAL-BANNED@"))).toBe(true);
  });

  it("parses a definition from YAML in the helper", () => {
    expect(
      parseDef(
        "schema_version: 1\nid: a\nname: A\nlegality_by: name\nsets: [M15]\n",
      ).sets,
    ).toEqual(["M15"]);
  });
});
