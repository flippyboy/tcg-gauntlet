import { describe, expect, it } from "vitest";
import { diffDecks } from "../src/index.js";
import { deck } from "./helpers.js";

const diff = (a: string, b: string) => diffDecks(deck(a), deck(b));

describe("diffDecks", () => {
  it("returns nothing for equal decks", () => {
    expect(
      diff(
        "4 Bolt\n2 Mountain\nSideboard\n1 Moon\n",
        "2 Mountain\n4 Bolt\nSideboard\n1 Moon\n",
      ),
    ).toEqual([]);
    expect(diff("", "")).toEqual([]);
  });

  it("reports removed and added cards, with their counts", () => {
    expect(diff("4 Bolt\n2 Char\n", "4 Bolt\n3 Helix\n")).toEqual([
      { kind: "removed", section: "main", name: "Char", from: 2 },
      { kind: "added", section: "main", name: "Helix", to: 3 },
    ]);
  });

  it("reports a count change, summing the lines of a card", () => {
    expect(diff("2 Bolt\n2 Bolt (M11)\n", "3 Bolt\n")).toEqual([
      { kind: "count", section: "main", name: "Bolt", from: 4, to: 3 },
    ]);
  });

  it("matches names after normalisation", () => {
    expect(
      diff("1 Wear // Tear\n1 Jötun Grunt\n", "1 wear/tear\n1 Jotun Grunt\n"),
    ).toEqual([]);
  });

  it("reports a printing change only when both sides give a set code and they differ", () => {
    expect(diff("4 Bolt (M11) 149\n", "4 Bolt (2XM) 117\n")).toEqual([
      {
        kind: "printing",
        section: "main",
        name: "Bolt",
        from: "M11 149",
        to: "2XM 117",
      },
    ]);
    expect(diff("4 Bolt (M11) 149\n", "4 Bolt (M11) 149\n")).toEqual([]);
    expect(diff("4 Bolt (M11)\n", "4 Bolt (M11) 149\n")).toHaveLength(1);
    expect(diff("4 Bolt (M11) 149\n", "4 Bolt (m11) 149\n")).toHaveLength(1);
  });

  it("reports no printing change between a default printing and an explicit one", () => {
    expect(diff("4 Bolt\n", "4 Bolt (M11) 149\n")).toEqual([]);
    expect(diff("4 Bolt (M11) 149\n", "4 Bolt\n")).toEqual([]);
    expect(diff("4 Bolt\n", "4 Bolt\n")).toEqual([]);
  });

  it("reports a count and a printing change for the same card", () => {
    expect(
      diff("4 Bolt (M11) 149\n", "3 Bolt (2XM) 117\n").map((e) => e.kind),
    ).toEqual(["count", "printing"]);
  });

  it("compares the printings of several lines as a set", () => {
    expect(
      diff(
        "2 Bolt (M11) 149\n2 Bolt (2XM) 117\n",
        "2 Bolt (2XM) 117\n2 Bolt (M11) 149\n",
      ),
    ).toEqual([]);
    expect(
      diff("2 Bolt (M11) 149\n2 Bolt\n", "4 Bolt (M10) 146\n")[0],
    ).toMatchObject({
      kind: "printing",
      from: "M11 149",
      to: "M10 146",
    });
  });

  it("treats a move between sections as a removal and an addition", () => {
    expect(
      diff(
        "4 Bolt\nSideboard\n1 Moon\n",
        "3 Bolt\n1 Moon\nSideboard\n1 Bolt\n",
      ),
    ).toEqual([
      { kind: "added", section: "main", name: "Moon", to: 1 },
      { kind: "count", section: "main", name: "Bolt", from: 4, to: 3 },
      { kind: "removed", section: "sideboard", name: "Moon", from: 1 },
      { kind: "added", section: "sideboard", name: "Bolt", to: 1 },
    ]);
  });

  it("sorts by section, then kind, then name", () => {
    const out = diff(
      "1 B\n1 A\n2 C\n3 D (SET) 1\nSideboard\n1 Z\n1 Y\n",
      "1 A\n1 E\n1 F\n3 D (OTH) 1\n3 C\nSideboard\n2 Y\n1 X\n",
    );
    expect(out.map((e) => `${e.section}:${e.kind}:${e.name}`)).toEqual([
      "main:removed:B",
      "main:added:E",
      "main:added:F",
      "main:count:C",
      "main:printing:D",
      "sideboard:removed:Z",
      "sideboard:added:X",
      "sideboard:count:Y",
    ]);
  });

  it("diffs Commander cards in their own section, last", () => {
    expect(diff("Commander\n1 X\nDeck\n1 A\n", "Deck\n1 B\n")).toEqual([
      { kind: "removed", section: "main", name: "A", from: 1 },
      { kind: "added", section: "main", name: "B", to: 1 },
      { kind: "removed", section: "commander", name: "X", from: 1 },
    ]);
  });
});
