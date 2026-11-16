import { describe, expect, it } from "vitest";
import { groupByType, groupOf, resolveDeck } from "../src/index.js";
import { deck, lookup } from "./helpers.js";

const entries = (text: string) =>
  resolveDeck(deck(text), "official:modern#mtgjson", lookup).entries;
const names = (
  g: { entries: { card: { name: string } | null }[] }[],
): string[][] => g.map((x) => x.entries.map((e) => e.card?.name ?? "?"));

describe("groupByType", () => {
  it("orders the groups, and leaves empty ones out", () => {
    const g = groupByType(
      entries(
        "1 Mountain\n1 Lightning Bolt\n1 Terminate\n1 Inquisition of Kozilek\n1 Liliana of the Veil\n1 Tarmogoyf\n1 Cranial Plating\n1 Blood Moon\n1 Black Lotus\n",
      ),
    );
    expect(g.main.map((x) => x.name)).toEqual([
      "Creature",
      "Planeswalker",
      "Instant",
      "Sorcery",
      "Artifact",
      "Enchantment",
      "Land",
    ]);
    expect(g.sideboard).toEqual([]);
  });

  it("puts a card in the first group whose type it has", () => {
    expect(groupOf(entries("1 Arcbound Ravager")[0]!)).toBe("Creature");
    expect(groupOf(entries("1 Eidolon of the Great Revel")[0]!)).toBe(
      "Creature",
    );
    expect(groupOf(entries("1 Cranial Plating")[0]!)).toBe("Artifact");
  });

  it("puts any card with the type Land in Land", () => {
    expect(groupOf(entries("1 Darksteel Citadel")[0]!)).toBe("Land");
    expect(groupOf(entries("1 Blinkmoth Nexus")[0]!)).toBe("Land");
    // Only the front face counts: a modal double-faced spell with a land back is a spell.
    expect(groupOf(entries("1 Sink into Stupor")[0]!)).toBe("Instant");
  });

  it("puts a card without any listed type, and an unknown card, in Other", () => {
    expect(groupOf(entries("1 Nonsense Card")[0]!)).toBe("Other");
    const g = groupByType(entries("1 Nonsense Card\n1 Mountain\n"));
    expect(g.main.map((x) => x.name)).toEqual(["Land", "Other"]);
  });

  it("orders within a group by mana value, then name", () => {
    const g = groupByType(
      entries(
        "1 Terminate\n1 Lightning Bolt\n1 Dismember\n1 Burst Lightning\n1 Char\n",
      ),
    );
    expect(names(g.main)).toEqual([
      ["Burst Lightning", "Lightning Bolt", "Terminate", "Char", "Dismember"],
    ]);
  });

  it("makes the sideboard a single group, ordered the same way", () => {
    const g = groupByType(
      entries(
        "1 Mountain\nSideboard\n1 Tarmogoyf\n1 Dismember\n1 Lightning Bolt\n",
      ),
    );
    expect(g.sideboard).toHaveLength(1);
    expect(g.sideboard[0]?.name).toBe("Sideboard");
    expect(names(g.sideboard)).toEqual([
      ["Lightning Bolt", "Tarmogoyf", "Dismember"],
    ]);
  });

  it("leaves Commander cards out", () => {
    const g = groupByType(
      entries("Commander\n1 Tarmogoyf\nDeck\n1 Mountain\n"),
    );
    expect(names(g.main)).toEqual([["Mountain"]]);
  });
});
