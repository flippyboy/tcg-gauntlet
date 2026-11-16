import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeLookup, runConformance } from "@tcg-gauntlet/conformance";
import {
  OFFICIAL_FORMAT_NAMES,
  type CardLookup,
  formatKey,
  parseFormatDef,
} from "@tcg-gauntlet/engine";
import { SqliteCardLookup } from "../src/index.js";
import {
  OFFICIAL_MODERN,
  fixturesDir,
  loadPreset,
  modernBuilds,
  openFixture,
  repoRoot,
} from "./helpers.js";

const names = readFileSync(`${fixturesDir}cards.txt`, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));

async function setup(): Promise<{
  sql: SqliteCardLookup;
  fake: CardLookup;
  presetKey: string;
}> {
  const { derived } = openFixture();
  const sql = new SqliteCardLookup(derived);
  const fake = fakeLookup(`${fixturesDir}cards.json`);
  const { preset } = await modernBuilds();
  sql.registerFormat(preset.key, loadPreset());
  fake.registerFormat(preset.key, loadPreset());
  return { sql, fake, presetKey: preset.key };
}

describe("SqliteCardLookup", () => {
  it("passes the conformance corpus with no mismatches", async () => {
    const { sql } = await setup();
    const mismatches = await runConformance(sql, {
      casesDir: `${repoRoot}conformance/cases`,
      presetsDir: `${repoRoot}presets`,
    });
    expect(mismatches).toEqual([]);
  });

  it("agrees with the in-memory lookup on every card in cards.txt", async () => {
    const { sql, fake, presetKey } = await setup();
    expect(names.length).toBeGreaterThan(100);
    for (const n of names) {
      const a = sql.findCard(n);
      const b = fake.findCard(n);
      expect(a, n).toEqual(b);
      expect(a, n).not.toBeNull();
      if (a === null || b === null) continue;
      for (const key of [presetKey, OFFICIAL_MODERN]) {
        expect(sql.defaultPrinting(key, a), `${n} default ${key}`).toEqual(
          fake.defaultPrinting(key, b),
        );
        expect(sql.inPool(key, a), `${n} pool ${key}`).toBe(
          fake.inPool(key, b),
        );
      }
      expect(sql.arenaPrinting(a), `${n} arena`).toEqual(fake.arenaPrinting(b));
      for (const f of OFFICIAL_FORMAT_NAMES) {
        expect(sql.officialLegality(f, a), `${n} ${f}`).toBe(
          fake.officialLegality(f, b),
        );
      }
      for (const set of ["m10", "KTK", "zzz"]) {
        expect(sql.findPrinting(set, undefined, a.name), `${n} ${set}`).toEqual(
          fake.findPrinting(set, undefined, b.name),
        );
      }
    }
  });

  it("finds a printing by set and number, ignoring letter case", async () => {
    const { sql } = await setup();
    const p = sql.findPrinting("m11", "149", "Lightning Bolt");
    expect(p).toMatchObject({ set: "M11", number: "149" });
    expect(sql.findPrinting("M11", "9999", "Lightning Bolt")).toBeNull();
    expect(sql.findPrinting("M11", undefined, "Goblin Guide")).toBeNull();
  });

  it("accepts every spelling of a name, and not a back face", async () => {
    const { sql } = await setup();
    const full = (s: string): string | undefined => sql.findCard(s)?.name;
    expect(full("Delver of Secrets")).toBe(
      "Delver of Secrets // Insectile Aberration",
    );
    expect(full("fire/ice")).toBe("Fire // Ice");
    expect(full("FIRE  //  ICE")).toBe("Fire // Ice");
    expect(full("Jotun Grunt")).toBe("Jötun Grunt");
    expect(full("Fire")).toBeUndefined();
    expect(full("Insectile Aberration")).toBeUndefined();
    expect(full("no such card")).toBeUndefined();
    // The second lookup is served from the cache.
    expect(full("fire/ice")).toBe("Fire // Ice");
  });

  it("describes copy exemptions", async () => {
    const { sql } = await setup();
    expect(sql.findCard("Mountain")?.copyExempt).toBe("basic");
    expect(sql.findCard("Relentless Rats")?.copyExempt).toBe("any_number");
    expect(sql.findCard("Lightning Bolt")?.copyExempt).toBeNull();
  });

  it("suggests the expected names for three typos", async () => {
    const { sql } = await setup();
    expect(sql.suggest("Lighnting Bolt", 3)[0]).toBe("Lightning Bolt");
    expect(sql.suggest("Goblin Gide", 3)[0]).toBe("Goblin Guide");
    expect(sql.suggest("Treasure Crusie", 3)[0]).toBe("Treasure Cruise");
    expect(sql.suggest("Lightning Bolt", 3)).toContain("Lightning Bolt");
    expect(sql.suggest("zzzzzzzz qqqqqq", 3)).toEqual([]);
    expect(sql.suggest("ab", 3)).toEqual([]);
    expect(sql.suggest("Lightning", 0)).toEqual([]);
  });

  it("reports its data version", async () => {
    const { sql } = await setup();
    expect(sql.dataVersion()).toMatch(/^mtgjson 5\./);
  });

  it("builds official formats on demand and rejects unknown custom keys", () => {
    const { derived } = openFixture();
    const sql = new SqliteCardLookup(derived);
    const bolt = sql.findCard("Lightning Bolt")!;
    expect(sql.inPool("official:vintage#mtgjson", bolt)).toBe(true);
    expect(
      sql.defaultPrinting("official:vintage#mtgjson", bolt),
    ).not.toBeNull();
    expect(() => sql.inPool("preset:nope@1#000000000000", bolt)).toThrow(
      /not registered/,
    );
    expect(() =>
      sql.defaultPrinting("preset:nope@1#000000000000", bolt),
    ).toThrow(/not registered/);
    sql.registerFormat("official:modern#mtgjson", loadPreset());
    sql.close();
  });

  it("applies include, exclude and banned of a definition", async () => {
    const { derived } = openFixture();
    const sql = new SqliteCardLookup(derived);
    const parsed = parseFormatDef(
      [
        "schema_version: 1",
        "id: tiny",
        "name: Tiny",
        "legality_by: name",
        "sets: [M11, KTK]",
        "banned: [Treasure Cruise]",
        "include:",
        "  - {name: Tarmogoyf, reason: test}",
        "exclude:",
        "  - {name: Lightning Bolt, reason: test}",
        "",
      ].join("\n"),
      "tiny.yaml",
    );
    const def = parsed.def!;
    const key = await formatKey("repo:formats/tiny.yaml", def);
    sql.registerFormat(key, def);
    const fake = fakeLookup(`${fixturesDir}cards.json`);
    fake.registerFormat(key, def);
    for (const n of names) {
      const a = sql.findCard(n)!;
      const b = fake.findCard(n)!;
      expect(sql.inPool(key, a), n).toBe(fake.inPool(key, b));
      expect(sql.defaultPrinting(key, a), n).toEqual(
        fake.defaultPrinting(key, b),
      );
    }
    expect(sql.poolSize(key)).toBeGreaterThan(5);
    expect(sql.inPool(key, sql.findCard("Tarmogoyf")!)).toBe(true);
    expect(sql.inPool(key, sql.findCard("Lightning Bolt")!)).toBe(false);
    expect(sql.inPool(key, sql.findCard("Treasure Cruise")!)).toBe(false);
    // Tarmogoyf is in no listed set, so its default printing comes from any set.
    expect(sql.defaultPrinting(key, sql.findCard("Tarmogoyf")!)).not.toBeNull();
  });
});
