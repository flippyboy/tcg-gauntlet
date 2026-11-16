import { describe, expect, it } from "vitest";
import { normalizeName } from "../src/index.js";

describe("normalizeName", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeName("  Lightning \t  BOLT ")).toBe("lightning bolt");
  });

  it("removes accents and ligature-free diacritics", () => {
    expect(normalizeName("Jötun Grunt")).toBe("jotun grunt");
    expect(normalizeName("Lim-Dûl's Vault")).toBe("lim-dul's vault");
    expect(normalizeName("Mañana")).toBe("manana");
  });

  it("applies NFKD to compatibility characters", () => {
    expect(normalizeName("ﬁre")).toBe("fire");
    expect(normalizeName("Ａ")).toBe("a");
  });

  it("turns curly quotes into straight quotes", () => {
    expect(normalizeName("Kolaghan’s Command")).toBe("kolaghan's command");
    expect(normalizeName("‘x’ “y”")).toBe("'x' \"y\"");
  });

  it("writes every split-card spelling the same way", () => {
    const canon = "fire // ice";
    for (const s of [
      "Fire // Ice",
      "Fire/Ice",
      "Fire / Ice",
      "Fire//Ice",
      "Fire  //  Ice",
      "fire /Ice",
      "Fire/ Ice",
      "FIRE\t/\tICE",
    ]) {
      expect(normalizeName(s), s).toBe(canon);
    }
  });

  it("is idempotent", () => {
    for (const s of [
      "Wear // Tear",
      "Wear/Tear",
      "Jötun  Grunt",
      "A / B / C",
    ]) {
      expect(normalizeName(normalizeName(s))).toBe(normalizeName(s));
    }
  });

  it("handles three-part names", () => {
    expect(normalizeName("Who/What/When")).toBe("who // what // when");
  });
});
