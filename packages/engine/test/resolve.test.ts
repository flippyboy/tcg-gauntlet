import { describe, expect, it } from "vitest";
import { resolveDeck } from "../src/index.js";
import {
  deck,
  lookup,
  registered,
  row,
  synthetic,
  tinyFormat,
} from "./helpers.js";

const OFFICIAL = "official:modern#mtgjson";

const printingOf = (text: string, key = OFFICIAL): string[] =>
  resolveDeck(deck(text), key, lookup).entries.map((e) =>
    e.printing ? `${e.printing.set}/${e.printing.number}` : "none",
  );

describe("resolveDeck: names", () => {
  it("finds a card by every accepted spelling", () => {
    const r = resolveDeck(
      deck(
        "1 lightning bolt\n1 Wear/Tear\n1 wear / tear\n1 Delver of Secrets\n1 Jötun Grunt\n1 Jotun Grunt\n1 Kolaghan’s Command\n",
      ),
      OFFICIAL,
      lookup,
    );
    expect(r.violations).toEqual([]);
    expect(r.entries.map((e) => e.card?.name)).toEqual([
      "Lightning Bolt",
      "Wear // Tear",
      "Wear // Tear",
      "Delver of Secrets // Insectile Aberration",
      "Jötun Grunt",
      "Jötun Grunt",
      "Kolaghan's Command",
    ]);
  });

  it("gives E-CARD-UNKNOWN with up to 3 suggestions, on the line", () => {
    const r = resolveDeck(
      deck("4 Lightning Bolt\n4 Lightening Bolt\n1 Qzxwv\n"),
      OFFICIAL,
      lookup,
    );
    expect(r.violations).toHaveLength(2);
    const [typo, nonsense] = r.violations;
    expect(typo).toMatchObject({
      code: "E-CARD-UNKNOWN",
      line: 2,
      severity: "error",
      file: "deck.txt",
    });
    expect(typo?.message).toContain("Lightning Bolt");
    expect(typo?.suggestion).toBe('Did you mean "Lightning Bolt"?');
    expect(typo?.message.split(";").length).toBeLessThanOrEqual(3);
    expect(nonsense?.code).toBe("E-CARD-UNKNOWN");
    expect(nonsense?.suggestion).toBeUndefined();
    expect(r.entries[1]).toMatchObject({ card: null, printing: null });
  });

  it("does not accept a back-face name or one half of a split card", () => {
    const r = resolveDeck(
      deck("1 Insectile Aberration\n1 Wear\n1 Tear\n"),
      OFFICIAL,
      lookup,
    );
    expect(r.violations.map((v) => v.code)).toEqual([
      "E-CARD-UNKNOWN",
      "E-CARD-UNKNOWN",
      "E-CARD-UNKNOWN",
    ]);
  });

  it("resolves Commander-section cards too", () => {
    const r = resolveDeck(deck("Commander\n1 Tarmogoyf\n"), OFFICIAL, lookup);
    expect(r.entries[0]).toMatchObject({ section: "commander" });
    expect(r.entries[0]?.card?.name).toBe("Tarmogoyf");
  });
});

describe("resolveDeck: printings", () => {
  it("uses the set and number of the line", () => {
    expect(
      printingOf("1 Lightning Bolt (M11) 149\n1 Lightning Bolt (m10) 146"),
    ).toEqual(["M11/149", "M10/146"]);
    const r = resolveDeck(deck("1 Lightning Bolt (M11) 149"), OFFICIAL, lookup);
    expect(r.entries[0]?.explicitPrinting).toBe(true);
  });

  it("uses the lowest number in the set when there is no number", () => {
    expect(printingOf("1 Mountain (M15)")).toEqual(["M15/262"]);
  });

  it("gives E-PRINTING-UNKNOWN and uses the default printing", () => {
    const r = resolveDeck(
      deck(
        "1 Lightning Bolt (XXX) 1\n1 Lightning Bolt (M11) 1\n1 Lightning Bolt (XXX)\n",
      ),
      OFFICIAL,
      lookup,
    );
    expect(r.violations.map((v) => `${v.code}@${v.line}`)).toEqual([
      "E-PRINTING-UNKNOWN@1",
      "E-PRINTING-UNKNOWN@2",
      "E-PRINTING-UNKNOWN@3",
    ]);
    expect(r.violations[2]?.message).toContain('"XXX"');
    const dflt = lookup.defaultPrinting(
      OFFICIAL,
      lookup.findCard("Lightning Bolt")!,
    );
    expect(r.entries.map((e) => e.printing?.uuid)).toEqual([
      dflt?.uuid,
      dflt?.uuid,
      dflt?.uuid,
    ]);
    expect(r.entries[0]?.explicitPrinting).toBe(false);
  });

  it("gives E-PRINTING-UNKNOWN for a printing of a different card", () => {
    const r = resolveDeck(deck("1 Goblin Guide (M11) 149"), OFFICIAL, lookup);
    expect(r.violations.map((v) => v.code)).toEqual(["E-PRINTING-UNKNOWN"]);
  });

  it("uses a hint only when it is a set that has the card", () => {
    const r = resolveDeck(
      deck(
        "1 [M11] Lightning Bolt\n1 [9E] Lightning Bolt\n1 [] Lightning Bolt\n1 [ZEN] Lightning Bolt",
      ),
      OFFICIAL,
      lookup,
    );
    expect(r.violations).toEqual([]);
    expect(r.entries.map((e) => e.explicitPrinting)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(r.entries[0]?.printing?.set).toBe("M11");
  });

  it("finds a collector number with a star, ignoring letter case", () => {
    expect(
      printingOf("1 Blood Moon (9ed) 176★\n1 Blood Moon (9ED) 176"),
    ).toEqual(["9ED/176★", "9ED/176"]);
  });

  it("uses the default printing of the format", async () => {
    const key = await registered(tinyFormat("", "[M10, M11]"));
    expect(printingOf("1 Lightning Bolt\n1 Ornithopter", key)).toEqual([
      "M10/146",
      "M10/216",
    ]);
  });
});

describe("resolveDeck: default basic lands", () => {
  const basics = "1 Plains\n1 Island\n1 Swamp\n1 Mountain\n1 Forest";
  const unh = ["UNH/136", "UNH/137", "UNH/138", "UNH/139", "UNH/140"];

  it("defaults the five basics to Unhinged, in official and custom formats", async () => {
    expect(printingOf(basics)).toEqual(unh);
    const key = await registered(tinyFormat("", "[M10, M11]"));
    expect(printingOf(basics, key)).toEqual(unh);
  });

  it("keeps the set code of a line", () => {
    expect(printingOf("4 Mountain (M15)\n1 Plains (M15) 250")).toEqual([
      "M15/262",
      "M15/250",
    ]);
  });

  it("leaves Wastes and snow basics on the normal rule", () => {
    expect(printingOf("1 Wastes\n1 Snow-Covered Island")).toEqual([
      "OGW/183",
      "ICE/371",
    ]);
  });

  it("does not put the Unhinged printing in a pool", async () => {
    const key = await registered(tinyFormat("", "[UNH]"));
    expect(lookup.inPool(key, lookup.findCard("Mountain")!)).toBe(false);
  });

  it("falls back to the normal rule when the Unhinged printing is missing", () => {
    const l = synthetic(
      [
        row({
          name: "Plains",
          setCode: "AAA",
          number: "5",
          supertypes: "Basic",
        }),
        row({
          name: "Plains",
          setCode: "UNH",
          number: "136",
          isFunny: 1,
          supertypes: "Basic",
        }),
        row({
          name: "Island",
          setCode: "AAA",
          number: "7",
          supertypes: "Basic",
        }),
        row({
          name: "Island",
          setCode: "UNH",
          number: "999",
          isFunny: 1,
          supertypes: "Basic",
        }),
      ],
      [
        { code: "AAA", releaseDate: "2000-01-01", type: "core" },
        { code: "UNH", releaseDate: "2003-11-14", type: "funny" },
      ],
    );
    const r = resolveDeck(deck("1 Plains\n1 Island"), OFFICIAL, l);
    expect(
      r.entries.map((e) => `${e.printing?.set}/${e.printing?.number}`),
    ).toEqual(["UNH/136", "AAA/7"]);
  });
});

describe("default printing tie-breaks", () => {
  const sets = [
    { code: "OLD", releaseDate: "2000-01-01", type: "expansion" },
    { code: "NEW", releaseDate: "2010-01-01", type: "expansion" },
    { code: "SAME", releaseDate: "2010-01-01", type: "core" },
    { code: "ODD", releaseDate: "2010-01-01", type: "masters" },
    { code: "PRM", releaseDate: "1990-01-01", type: "promo" },
  ];
  const pick = (
    rows: ReturnType<typeof row>[],
    key = OFFICIAL,
  ): string | undefined => {
    const l = synthetic(rows, sets);
    const card = l.findCard("Test Card")!;
    const p = l.defaultPrinting(key, card);
    return p === null ? undefined : `${p.set}/${p.number}`;
  };

  it("takes the oldest set release date", () => {
    expect(pick([row({ setCode: "NEW" }), row({ setCode: "OLD" })])).toBe(
      "OLD/1",
    );
  });

  it("prefers the card's original release date to the set's", () => {
    expect(
      pick([
        row({ setCode: "NEW", originalReleaseDate: "1995-01-01" }),
        row({ setCode: "OLD", originalReleaseDate: "1999-06-01" }),
        row({ setCode: "OLD", number: "9" }),
      ]),
    ).toBe("NEW/1");
  });

  it("puts core and expansion sets before other types on the same date", () => {
    expect(
      pick([row({ setCode: "ODD" }), row({ setCode: "NEW", number: "7" })]),
    ).toBe("NEW/7");
    expect(
      pick([row({ setCode: "ODD" }), row({ setCode: "SAME", number: "9" })]),
    ).toBe("SAME/9");
  });

  it("uses the numeric part of the collector number, then the text, then the uuid", () => {
    expect(pick([row({ number: "10" }), row({ number: "9" })])).toBe("AAA/9");
    expect(pick([row({ number: "9b" }), row({ number: "9a" })])).toBe("AAA/9a");
    expect(pick([row({ number: "9a" }), row({ number: "9" })])).toBe("AAA/9");
    expect(pick([row({ number: "X" }), row({ number: "100" })])).toBe(
      "AAA/100",
    );
    expect(pick([row({ number: "B" }), row({ number: "A" })])).toBe("AAA/A");
    expect(
      pick([
        row({ number: "5", uuid: "zz" }),
        row({ number: "5", uuid: "aa", scryfallId: "S" }),
      ]),
    ).toBe("AAA/5");
    const l = synthetic(
      [row({ number: "5", uuid: "zz" }), row({ number: "5", uuid: "aa" })],
      sets,
    );
    expect(l.defaultPrinting(OFFICIAL, l.findCard("Test Card")!)?.uuid).toBe(
      "aa",
    );
  });

  it("compares dates as text and numbers by code point", () => {
    expect(pick([row({ number: "★" }), row({ number: "z" })])).toBe("AAA/z");
  });

  it("skips what does not qualify", () => {
    const skip = [
      row({ setCode: "OLD", availability: "mtgo" }),
      row({ setCode: "OLD", isOnlineOnly: 1 }),
      row({ setCode: "OLD", isFunny: 1 }),
      row({ setCode: "OLD", isOversized: 1 }),
      row({ setCode: "OLD", side: "b" }),
      row({ setCode: "OLD", language: "German" }),
      row({ setCode: "OLD", language: null }),
    ];
    expect(pick([...skip, row({ setCode: "NEW", number: "3" })])).toBe("NEW/3");
    expect(
      pick([row({ setCode: "OLD", side: "a", number: "4" }), ...skip]),
    ).toBe("OLD/4");
  });

  it("counts a NULL flag as false", () => {
    expect(
      pick([
        row({
          isOnlineOnly: null,
          isFunny: null,
          isOversized: null,
          isPromo: null,
        }),
      ]),
    ).toBe("AAA/1");
    expect(
      pick([row({ isOnlineOnly: 0, isFunny: 0, isOversized: 0, isPromo: 0 })]),
    ).toBe("AAA/1");
  });

  it("skips promos unless the card has no other printing", () => {
    expect(
      pick([
        row({ setCode: "PRM", isPromo: 1 }),
        row({ setCode: "NEW", number: "2" }),
      ]),
    ).toBe("NEW/2");
    expect(
      pick([
        row({ setCode: "PRM", isPromo: 1 }),
        row({ setCode: "OLD", availability: "mtgo" }),
      ]),
    ).toBe("PRM/1");
  });

  it("limits a custom format to its sets, and drops that limit when none qualifies", () => {
    const l = synthetic(
      [row({ setCode: "OLD" }), row({ setCode: "NEW", number: "2" })],
      sets,
    );
    const card = l.findCard("Test Card")!;
    const mk = (sets: string): string => {
      const def = tinyFormat("", sets);
      l.registerFormat(`k${sets}`, def);
      const p = l.defaultPrinting(`k${sets}`, card);
      return p === null ? "none" : `${p.set}/${p.number}`;
    };
    expect(mk("[NEW]")).toBe("NEW/2");
    expect(mk("[OLD, NEW]")).toBe("OLD/1");
    expect(mk("[ZZZ]")).toBe("OLD/1");
    const none = synthetic([row({ availability: "mtgo" })], sets);
    none.registerFormat("k", tinyFormat("", "[AAA]"));
    expect(none.defaultPrinting("k", none.findCard("Test Card")!)).toBeNull();
    expect(
      none.defaultPrinting(OFFICIAL, none.findCard("Test Card")!),
    ).toBeNull();
  });

  it("refuses a custom format that was not registered", () => {
    const l = synthetic([row({})], sets);
    expect(() => l.defaultPrinting("nope#1", l.findCard("Test Card")!)).toThrow(
      /not registered/,
    );
    expect(() => l.inPool("nope#1", l.findCard("Test Card")!)).toThrow(
      /not registered/,
    );
  });

  it("answers findPrinting with the English row and the lowest number", () => {
    const l = synthetic(
      [
        row({ setCode: "OLD", number: "10" }),
        row({ setCode: "OLD", number: "9", language: "German" }),
        row({ setCode: "OLD", number: "9", language: "English" }),
        row({ setCode: "OLD", number: "2", language: "German" }),
        row({ setCode: "NEW", number: "1", side: "b" }),
      ],
      sets,
    );
    const at = (s: string, n?: string): string | undefined => {
      const p = l.findPrinting(s, n, "Test Card");
      return p ? `${p.set}/${p.number}/${p.cardName}` : undefined;
    };
    expect(at("old", "9")).toBe("OLD/9/Test Card");
    expect(l.findPrinting("OLD", "9", "Test Card")?.uuid).toBe(
      l.findPrinting("OLD", "9", "Test Card")?.uuid,
    );
    expect(at("OLD")).toBe("OLD/9/Test Card");
    expect(at("OLD", "11")).toBeUndefined();
    expect(at("NEW", "1")).toBeUndefined();
    expect(at("OLD", "2")).toBe("OLD/2/Test Card");
    expect(l.findPrinting("OLD", "9", "Other")).toBeNull();
  });
});
