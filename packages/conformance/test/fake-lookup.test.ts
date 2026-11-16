import { describe, expect, it } from "vitest";
import { FakeCardLookup, type FixtureCard, fakeLookup } from "../src/index.js";

const root = new URL("../../../", import.meta.url).pathname;
const lookup = fakeLookup(`${root}conformance/fixtures/cards.json`);

describe("fakeLookup", () => {
  it("knows the data version", () => {
    expect(lookup.dataVersion()).toMatch(/^fixture 5\./);
  });

  it("finds cards by full name, front face, split spelling and accents, and not by a half", () => {
    const names = (s: string): string | undefined => lookup.findCard(s)?.name;
    expect(names("Delver of Secrets")).toBe(
      "Delver of Secrets // Insectile Aberration",
    );
    expect(names("Bonecrusher Giant")).toBe("Bonecrusher Giant // Stomp");
    expect(names("fire/ice")).toBe("Fire // Ice");
    expect(names("Jotun Grunt")).toBe("Jötun Grunt");
    expect(names("Fire")).toBeUndefined();
    expect(names("Insectile Aberration")).toBeUndefined();
    expect(names("Stomp")).toBeUndefined();
  });

  it("describes a card", () => {
    const wear = lookup.findCard("Wear // Tear")!;
    expect(wear).toMatchObject({ layout: "split", copyExempt: null });
    expect(wear.faces).toEqual([
      { name: "Wear", side: "a" },
      { name: "Tear", side: "b" },
    ]);
    const delver = lookup.findCard("Delver of Secrets")!;
    expect(delver.faces.map((f) => f.name)).toEqual([
      "Delver of Secrets",
      "Insectile Aberration",
    ]);
    expect(delver.types).toEqual(["Creature"]);
    expect(lookup.findCard("Mountain")).toMatchObject({
      copyExempt: "basic",
      supertypes: ["Basic"],
    });
    expect(lookup.findCard("Relentless Rats")?.copyExempt).toBe("any_number");
    expect(lookup.findCard("Darksteel Citadel")?.types).toEqual([
      "Artifact",
      "Land",
    ]);
    expect(lookup.findCard("Lightning Bolt")).toMatchObject({
      manaValue: 1,
      types: ["Instant"],
    });
  });

  it("describes a printing", () => {
    const p = lookup.findPrinting(
      "ISD",
      "51",
      "Delver of Secrets // Insectile Aberration",
    )!;
    expect(p).toMatchObject({
      set: "ISD",
      number: "51",
      hasBackFace: true,
      releasedAt: "2011-09-30",
    });
    expect(p.availability).toContain("paper");
    expect(p.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      lookup.findPrinting("M11", "149", "Lightning Bolt")?.hasBackFace,
    ).toBe(false);
  });

  it("suggests close names, best first, and nothing for nonsense", () => {
    expect(lookup.suggest("Lightening Bolt", 3)[0]).toBe("Lightning Bolt");
    expect(lookup.suggest("Tarmogoff", 3)).toContain("Tarmogoyf");
    expect(lookup.suggest("Goblin Guid", 3)[0]).toBe("Goblin Guide");
    expect(lookup.suggest("Qzxwv", 3)).toEqual([]);
    expect(lookup.suggest("Lightning", 2)).toHaveLength(2);
    expect(lookup.suggest("lightning bolt", 1)).toEqual(["Lightning Bolt"]);
  });

  it("treats official keys as having no pool and no registration", () => {
    expect(
      lookup.inPool(
        "official:modern#mtgjson",
        lookup.findCard("Lightning Bolt")!,
      ),
    ).toBe(true);
  });

  it("forgets cached answers when a format is registered again", () => {
    const def = (
      sets: string,
    ): Parameters<typeof lookup.registerFormat>[1] => ({
      schema_version: 1,
      id: "x",
      name: "X",
      legality_by: "name",
      sets: sets.split(","),
      banned: [],
      restricted: [],
      include: [],
      exclude: [],
      deck: { min_main: 60, max_sideboard: 15, max_copies: 4, copy_exempt: [] },
    });
    const card = lookup.findCard("Lightning Bolt")!;
    lookup.registerFormat("k#1", def("M10"));
    expect(lookup.inPool("k#1", card)).toBe(true);
    expect(lookup.defaultPrinting("k#1", card)?.set).toBe("M10");
    lookup.registerFormat("k#1", def("M11"));
    expect(lookup.inPool("k#1", card)).toBe(true);
    expect(lookup.defaultPrinting("k#1", card)?.set).toBe("M11");
    lookup.registerFormat("k#1", def("FRF"));
    expect(lookup.inPool("k#1", card)).toBe(false);
  });
});

describe("arenaPrinting", () => {
  let n = 0;
  const row = (over: Partial<FixtureCard>): FixtureCard => ({
    uuid: `u${String(++n).padStart(3, "0")}`,
    name: "Card",
    faceName: null,
    side: null,
    setCode: "AAA",
    number: "1",
    language: "English",
    availability: "arena, paper",
    isFunny: null,
    isOnlineOnly: null,
    isOversized: null,
    isPromo: null,
    originalReleaseDate: null,
    layout: "normal",
    types: "Creature",
    supertypes: null,
    manaValue: 1,
    text: null,
    scryfallId: null,
    legalities: {},
    ...over,
  });
  const sets = [
    { code: "OLD", releaseDate: "2020-01-01", type: "expansion" },
    { code: "NEW", releaseDate: "2022-01-01", type: "expansion" },
    { code: "MST", releaseDate: "2022-01-01", type: "masters" },
    { code: "EXP", releaseDate: "2022-01-01", type: "expansion" },
  ].map((s) => ({ ...s, name: s.code }));
  const pick = (cards: FixtureCard[]): string | undefined => {
    const l = new FakeCardLookup({
      mtgjson: { version: "t", date: null },
      sets,
      cards,
    });
    const p = l.arenaPrinting(l.findCard("Card")!);
    return p === null ? undefined : `${p.set}/${p.number}`;
  };

  it("takes the newest printing on Arena", () => {
    expect(pick([row({ setCode: "OLD" }), row({ setCode: "NEW" })])).toBe(
      "NEW/1",
    );
  });

  it("uses the original release date before the set date", () => {
    expect(
      pick([
        row({ setCode: "NEW" }),
        row({ setCode: "OLD", originalReleaseDate: "2023-05-05" }),
      ]),
    ).toBe("OLD/1");
  });

  it("skips printings that are not on Arena, not English, or not a front face", () => {
    expect(
      pick([
        row({ setCode: "OLD" }),
        row({ setCode: "NEW", availability: "paper" }),
        row({ setCode: "NEW", availability: null }),
        row({ setCode: "NEW", language: "German" }),
        row({ setCode: "NEW", side: "b" }),
      ]),
    ).toBe("OLD/1");
    expect(pick([row({ availability: "paper" })])).toBeUndefined();
  });

  it("accepts side a", () => {
    expect(pick([row({ side: "a", setCode: "NEW" })])).toBe("NEW/1");
  });

  it("breaks date ties by set type, then number, then text, then uuid", () => {
    expect(pick([row({ setCode: "MST" }), row({ setCode: "EXP" })])).toBe(
      "EXP/1",
    );
    expect(
      pick([
        row({ number: "10" }),
        row({ number: "9" }),
        row({ number: "9a" }),
      ]),
    ).toBe("AAA/9");
    expect(pick([row({ number: "9a" }), row({ number: "9" })])).toBe("AAA/9");
    const a = row({ uuid: "z" });
    const b = row({ uuid: "a" });
    const l = new FakeCardLookup({
      mtgjson: { version: "t", date: null },
      sets,
      cards: [a, b],
    });
    expect(l.arenaPrinting(l.findCard("Card")!)?.uuid).toBe("a");
  });
});
