import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CardLookup,
  type CardRef,
  type PrintingRef,
  exportDec,
  exportMtga,
  exportMtgo,
  normalizeName,
  parseDeck,
  resolveDeck,
} from "../src/index.js";
import { lookup, repoRoot } from "./helpers.js";

const OFFICIAL = "official:modern#mtgjson";
const resolve = (text: string, path = "deck.txt") =>
  resolveDeck(parseDeck(text, path), OFFICIAL, lookup);

const mtga = (d: ReturnType<typeof resolve>) => exportMtga(d, lookup);

describe("exportMtgo", () => {
  it("writes N Name lines, a Sideboard line, and CRLF after every line", () => {
    const r = exportMtgo(
      resolve(
        "2 Lightning Bolt (M11) 149\n1 Mountain\nSideboard\n3 Dismember\n",
      ),
    );
    expect(r.text).toBe(
      "2 Lightning Bolt\r\n1 Mountain\r\nSideboard\r\n3 Dismember\r\n",
    );
    expect(r.warnings).toEqual([]);
  });

  it("leaves out the Sideboard line when the sideboard is empty", () => {
    expect(exportMtgo(resolve("2 Lightning Bolt\n")).text).toBe(
      "2 Lightning Bolt\r\n",
    );
    expect(exportMtgo(resolve("")).text).toBe("");
  });

  it("writes split cards as A/B and double-faced and adventure cards by front face", () => {
    const r = exportMtgo(
      resolve(
        "1 Wear // Tear\n1 Delver of Secrets\n1 Bonecrusher Giant\n1 Sink into Stupor\n1 Huntmaster of the Fells // Ravager of the Fells\n",
      ),
    );
    expect(r.text.split("\r\n")).toEqual([
      "1 Delver of Secrets",
      "1 Bonecrusher Giant",
      "1 Huntmaster of the Fells",
      "1 Sink into Stupor",
      "1 Wear/Tear",
      "",
    ]);
  });

  it("merges the lines of one card, whatever their printing", () => {
    expect(
      exportMtgo(
        resolve("2 Lightning Bolt (M11) 149\n2 Lightning Bolt (M10)\n"),
      ).text,
    ).toBe("4 Lightning Bolt\r\n");
  });

  it("keeps the name of an unknown card as written, and leaves Commander cards out", () => {
    expect(
      exportMtgo(resolve("Commander\n1 Tarmogoyf\nDeck\n1 Nonsense Card\n"))
        .text,
    ).toBe("1 Nonsense Card\r\n");
  });

  it("orders by type group, then mana value, then name", () => {
    expect(
      exportMtgo(
        resolve(
          "1 Mountain\n1 Terminate\n1 Tarmogoyf\n1 Dark Confidant\n1 Lightning Bolt\n",
        ),
      ).text,
    ).toBe(
      "1 Dark Confidant\r\n1 Tarmogoyf\r\n1 Lightning Bolt\r\n1 Terminate\r\n1 Mountain\r\n",
    );
  });
});

describe("exportDec", () => {
  it("writes the header, N [] Name lines and SB:  lines, with CRLF after every line", () => {
    const text =
      "---\nname: Burn\nauthor: Example Player\n---\n2 Lightning Bolt (M11) 149\n1 Wear // Tear\nSideboard\n2 Wear // Tear\n";
    const r = exportDec(resolve(text, "burn.txt"), { formatName: "Modern" });
    expect(r.text).toBe(
      [
        "// Deck file created with tcg-gauntlet",
        "// NAME : Burn",
        "// CREATOR : Example Player",
        "// FORMAT : Modern",
        "2 [] Lightning Bolt",
        "1 [] Wear / Tear",
        "SB:  2 [] Wear / Tear",
        "",
      ].join("\r\n"),
    );
    expect(r.warnings).toEqual([]);
  });

  it("uses the file name for NAME, and leaves out CREATOR and FORMAT when unknown", () => {
    const r = exportDec(resolve("1 Mountain\n", "decks/My Burn.txt"));
    expect(r.text).toBe(
      "// Deck file created with tcg-gauntlet\r\n// NAME : My Burn\r\n1 [] Mountain\r\n",
    );
    expect(
      exportDec(resolve("1 Mountain\n", "x.txt"), { formatName: "" }).text,
    ).not.toContain("FORMAT");
    expect(exportDec(resolve("1 Mountain\n", "plain")).text).toContain(
      "// NAME : plain\r\n",
    );
  });

  it("keeps header fields on one line", () => {
    const text =
      '---\nname: |\n  Two\n  lines\nauthor: "a\\r\\nb"\n---\n1 Mountain\n';
    const out = exportDec(resolve(text), { formatName: "A\nB" }).text;
    expect(out.split("\r\n").filter((l) => l.startsWith("//"))).toEqual([
      "// Deck file created with tcg-gauntlet",
      "// NAME : Two lines",
      "// CREATOR : a b",
      "// FORMAT : A B",
    ]);
  });

  it("writes no set codes", () => {
    expect(
      exportDec(resolve("1 [M11] Lightning Bolt\n1 Mountain (M15) 262\n")).text,
    ).not.toMatch(/\[[A-Z]/);
  });

  it("writes a deck with no sideboard without SB lines", () => {
    expect(exportDec(resolve("1 Mountain\n")).text).not.toContain("SB:");
  });
});

describe("exportMtga", () => {
  it("writes N Name (SET) num lines, one empty line, LF, and no final newline", () => {
    const r = mtga(
      resolve(
        "2 Lightning Bolt (M11) 149\n1 Wear // Tear (DGM) 135\nSideboard\n3 Rest in Peace (RTR) 18\n",
      ),
    );
    expect(r.text).toBe(
      "2 Lightning Bolt (M11) 149\n1 Wear // Tear (DGM) 135\n\n3 Rest in Peace (RTR) 18",
    );
    expect(r.text.includes("\r")).toBe(false);
  });

  it("writes no empty line when the sideboard is empty", () => {
    expect(mtga(resolve("1 Lightning Bolt (M11) 149\n")).text).toBe(
      "1 Lightning Bolt (M11) 149",
    );
    expect(mtga(resolve("")).text).toBe("");
  });

  it("uses the Arena printing when the line has no set code, and the line's printing when it has one", () => {
    const r = mtga(resolve("1 Burst Lightning\n1 Burst Lightning (ZEN) 119\n"));
    const card = lookup.findCard("Burst Lightning")!;
    const arena = lookup.arenaPrinting(card)!;
    const dflt = lookup.defaultPrinting(OFFICIAL, card)!;
    expect(`${arena.set}/${arena.number}`).toBe("SOA/41");
    expect(`${dflt.set}/${dflt.number}`).toBe("ZEN/119");
    expect(r.text).toBe(
      `1 Burst Lightning (SOA) 41\n1 Burst Lightning (ZEN) 119`,
    );
  });

  it("no set code, card has an Arena printing: the newest one, and no warning", () => {
    const r = mtga(resolve("2 Monastery Swiftspear\n"));
    expect(r.text).toBe("2 Monastery Swiftspear (PIO) 147");
    expect(r.warnings).toEqual([]);
  });

  it("no set code, card has no Arena printing: the resolved printing, and a warning", () => {
    const card = lookup.findCard("Goblin Guide")!;
    expect(lookup.arenaPrinting(card)).toBeNull();
    const dflt = lookup.defaultPrinting(OFFICIAL, card)!;
    const r = mtga(resolve("// c\n4 Goblin Guide\n"));
    expect(r.text).toBe(`4 Goblin Guide (${dflt.set}) ${dflt.number}`);
    expect(r.warnings.map((w) => `${w.code}@${w.line}`)).toEqual([
      "W-MTGA-UNAVAILABLE@2",
    ]);
  });

  it("set code on Arena: kept, and no warning, even when a newer Arena printing exists", () => {
    const card = lookup.findCard("Monastery Swiftspear")!;
    expect(lookup.arenaPrinting(card)?.set).toBe("PIO");
    const r = mtga(resolve("1 Monastery Swiftspear (KTK) 118\n"));
    expect(r.text).toBe("1 Monastery Swiftspear (KTK) 118");
    expect(r.warnings).toEqual([]);
  });

  it("set code not on Arena: kept, and a warning, even when the card has an Arena printing", () => {
    const card = lookup.findCard("Burst Lightning")!;
    expect(lookup.arenaPrinting(card)).not.toBeNull();
    const r = mtga(resolve("1 Burst Lightning (ZEN) 119\n"));
    expect(r.text).toBe("1 Burst Lightning (ZEN) 119");
    expect(r.warnings.map((w) => `${w.code}@${w.line}`)).toEqual([
      "W-MTGA-UNAVAILABLE@1",
    ]);
  });

  it("merges no-set lines and lines with the Arena printing's set code into one line", () => {
    const r = mtga(resolve("2 Burst Lightning\n2 Burst Lightning (SOA) 41\n"));
    expect(r.text).toBe("4 Burst Lightning (SOA) 41");
  });

  it("leaves other exports on the resolved printing", () => {
    const r = resolve("1 Burst Lightning\n");
    expect(r.entries[0]?.printing?.set).toBe("ZEN");
    expect(exportMtgo(r).text).toBe("1 Burst Lightning\r\n");
  });

  it("merges lines of one card only when the printing is the same", () => {
    const r = mtga(
      resolve(
        "2 Lightning Bolt (M11) 149\n1 Lightning Bolt (M11) 149\n1 Lightning Bolt (M10) 146\n",
      ),
    );
    expect(r.text).toBe(
      "3 Lightning Bolt (M11) 149\n1 Lightning Bolt (M10) 146",
    );
  });

  it("writes split cards as A // B and double-faced cards by front face", () => {
    const r = mtga(
      resolve("1 Wear/Tear (DGM) 135\n1 Delver of Secrets (ISD) 51\n"),
    );
    expect(r.text).toBe(
      "1 Delver of Secrets (ISD) 51\n1 Wear // Tear (DGM) 135",
    );
  });

  it("keeps a card that is not on Arena, and adds W-MTGA-UNAVAILABLE on its line", () => {
    const r = mtga(
      resolve(
        "4 Lightning Bolt (M11) 149\n2 Wear // Tear (DGM) 135\n1 Lightning Bolt (M10) 146\n",
      ),
    );
    expect(r.text).toContain("2 Wear // Tear (DGM) 135");
    const arena = (set: string, number: string): boolean =>
      lookup
        .findPrinting(set, number, "Lightning Bolt")!
        .availability.includes("arena");
    expect(arena("M11", "149")).toBe(false);
    expect(r.warnings.map((w) => `${w.code}@${w.line}:${w.severity}`)).toEqual([
      "W-MTGA-UNAVAILABLE@1:warning",
      "W-MTGA-UNAVAILABLE@2:warning",
      "W-MTGA-UNAVAILABLE@3:warning",
    ]);
    expect(r.warnings[0]?.message).toContain("Lightning Bolt");
    expect(r.warnings[0]?.file).toBe("deck.txt");
  });

  it("does not warn about a printing that is on Arena", () => {
    // Lightning Bolt in Magic 2015 is on Arena in the fixture data.
    const arena = ["M15/145", "M15/146"].find((x) => {
      const [s, n] = x.split("/");
      return lookup
        .findPrinting(s!, n, "Lightning Bolt")
        ?.availability.includes("arena");
    });
    if (arena === undefined) return;
    const [s, n] = arena.split("/");
    expect(mtga(resolve(`1 Lightning Bolt (${s}) ${n}\n`)).warnings).toEqual(
      [],
    );
  });

  it("writes a card with no default printing without a set code", () => {
    const l = emptyLookup((n) => ({ name: n, layout: "normal" }));
    const r = mtga(
      resolveDeck(parseDeck("2 Foo\nSideboard\n1 Bar\n", "x.txt"), "k", l),
    );
    expect(r.text).toBe("2 Foo\n\n1 Bar");
    expect(r.warnings).toEqual([]);
  });
});

// ------------------------------------------------------------------------------
// The mtgtop8 samples are a layout reference. A lookup that accepts any name lets
// us compare our layout with theirs, line for line, as sets of lines.

function emptyLookup(
  card: (name: string) => Partial<CardRef> & { name: string },
): CardLookup {
  const make = (name: string): CardRef => {
    const c = card(name);
    const faces = c.faces ?? [{ name: c.name, side: "a" }];
    return {
      name: c.name,
      oracleKey: c.name,
      types: c.types ?? [],
      supertypes: [],
      layout: c.layout ?? "normal",
      manaValue: 0,
      faces,
      copyExempt: null,
    };
  };
  return {
    findCard: (name) => make(name),
    findPrinting: () => null,
    inPool: () => true,
    officialLegality: () => "legal",
    defaultPrinting: () => null,
    arenaPrinting: () => null,
    suggest: () => [],
    dataVersion: () => "test",
  };
}

const sampleLookup: CardLookup = {
  ...emptyLookup((raw) => {
    const n = normalizeName(raw);
    if (n === "wear // tear") {
      return {
        name: "Wear // Tear",
        layout: "split",
        faces: [
          { name: "Wear", side: "a" },
          { name: "Tear", side: "b" },
        ],
      };
    }
    if (n === "sink into stupor") {
      return {
        name: "Sink into Stupor // Soporific Springs",
        layout: "modal_dfc",
        faces: [
          { name: "Sink into Stupor", side: "a" },
          { name: "Soporific Springs", side: "b" },
        ],
      };
    }
    return { name: raw.trim() };
  }),
  findPrinting: (set, number, cardName): PrintingRef => ({
    uuid: `${set}${number ?? ""}${cardName}`,
    cardName,
    set: set.toUpperCase(),
    number: number ?? "0",
    scryfallId: null,
    releasedAt: null,
    availability: ["paper", "arena"],
    hasBackFace: false,
  }),
};

const samples = `${repoRoot}conformance/layout-samples/mtgtop8/`;
const sample = (file: string): string => readFileSync(samples + file, "latin1");
const resolveSample = (file: string) =>
  resolveDeck(
    parseDeck(new Uint8Array(readFileSync(samples + file)), file),
    "k",
    sampleLookup,
  );
const sorted = (xs: string[]): string[] => [...xs].sort();

describe.each(["910585", "910594", "910599"])(
  "layout of mtgtop8 deck %s",
  (id) => {
    it("MTGO: the same lines, the Sideboard marker, CRLF everywhere including the last line", () => {
      const theirs = sample(`${id}.mtgo.txt`);
      const ours = exportMtgo(resolveSample(`${id}.mtgo.txt`)).text;
      expect(ours.endsWith("\r\n")).toBe(true);
      expect(ours.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
      expect(ours).not.toMatch(/\r\n\r\n/);
      const split = (t: string): [string[], string[]] => {
        const l = t.split("\r\n").slice(0, -1);
        const i = l.indexOf("Sideboard");
        return [l.slice(0, i), l.slice(i + 1)];
      };
      const [tm, ts] = split(theirs);
      const [om, os] = split(ours);
      expect(sorted(om)).toEqual(sorted(tm));
      expect(sorted(os)).toEqual(sorted(ts));
    });

    it(".dec: the same lines with empty brackets, CRLF, and our own first comment line", () => {
      const theirs = sample(`${id}.dec`);
      const ours = exportDec(resolveSample(`${id}.dec`)).text;
      expect(
        ours.startsWith("// Deck file created with tcg-gauntlet\r\n"),
      ).toBe(true);
      expect(ours.endsWith("\r\n")).toBe(true);
      const cards = (t: string, sb: boolean): string[] =>
        t
          .split("\r\n")
          .filter(
            (l) =>
              l !== "" && !l.startsWith("//") && l.startsWith("SB:") === sb,
          )
          .map((l) => l.replace(/\[[^\]]*\]/, "[]"));
      expect(sorted(cards(ours, false))).toEqual(sorted(cards(theirs, false)));
      expect(sorted(cards(ours, true))).toEqual(sorted(cards(theirs, true)));
      expect(cards(ours, true).every((l) => l.startsWith("SB:  "))).toBe(true);
    });

    it("MTGA: the same lines, LF, no final newline, one empty line before the sideboard", () => {
      const theirs = sample(`${id}.mtga.txt`);
      const ours = exportMtga(
        resolveSample(`${id}.mtga.txt`),
        sampleLookup,
      ).text;
      expect(ours.includes("\r")).toBe(false);
      expect(ours.endsWith("\n")).toBe(false);
      expect(ours.split("\n\n")).toHaveLength(2);
      // mtgtop8 glues the count of a card it drops onto the next line (for example
      // "44 Subtlety"). Those lines are a site bug, so they are left out.
      const clean = (t: string): string[] =>
        t.split("\n").filter((l) => l !== "" && Number(l.split(" ")[0]) < 10);
      expect(sorted(clean(ours))).toEqual(sorted(clean(theirs)));
    });
  },
);
