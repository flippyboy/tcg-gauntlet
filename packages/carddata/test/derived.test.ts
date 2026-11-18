import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Derived, TOOL_SCHEMA, fileUri } from "../src/index.js";
import {
  OFFICIAL_MODERN,
  modernBuilds,
  openFixture,
  tempDir,
  copyFixture,
  fixtureVersion,
} from "./helpers.js";

const count = (d: Derived, sql: string, ...args: string[]): number =>
  (d.db.prepare(sql).get(...args) as { n: number }).n;

describe("Derived", () => {
  it("builds base, pool and default-printing rows", async () => {
    const { derived } = openFixture();
    const { preset, official } = await modernBuilds();
    derived.ensureFormats([preset, official]);

    expect(count(derived, "SELECT COUNT(*) n FROM card_names")).toBeGreaterThan(
      100,
    );
    expect(count(derived, "SELECT COUNT(*) n FROM card_names_fts")).toBe(
      count(derived, "SELECT COUNT(*) n FROM card_names"),
    );
    expect(count(derived, "SELECT COUNT(*) n FROM card_meta")).toBe(116);
    expect(derived.getMeta("tool_schema")).toBe(TOOL_SCHEMA);
    expect(derived.getMeta("mtgjson_version")).toBe(fixtureVersion);
    expect(derived.formatKeys().sort()).toEqual(
      [OFFICIAL_MODERN, preset.key].sort(),
    );

    // Cloudpost is banned, Lightning Bolt (M11) is in the pool.
    const inPool = (n: string): number =>
      count(
        derived,
        "SELECT COUNT(*) n FROM format_pool WHERE format_key = ? AND name = ?",
        preset.key,
        n,
      );
    expect(inPool("Lightning Bolt")).toBe(1);
    expect(inPool("Cloudpost")).toBe(0);
    // An official format has no pool rows, but has default printings.
    expect(
      count(
        derived,
        "SELECT COUNT(*) n FROM format_pool WHERE format_key = ?",
        OFFICIAL_MODERN,
      ),
    ).toBe(0);
    expect(
      count(
        derived,
        "SELECT COUNT(*) n FROM default_printing WHERE format_key = ?",
        OFFICIAL_MODERN,
      ),
    ).toBeGreaterThan(50);

    const bolt = derived.db
      .prepare(
        "SELECT p.uuid, c.setCode, c.number FROM default_printing p JOIN mtg.cards c ON c.uuid = p.uuid WHERE p.format_key = ? AND p.name = 'Lightning Bolt'",
      )
      .get(OFFICIAL_MODERN) as { setCode: string };
    expect(bolt.setCode).toBeTruthy();
    derived.close();
  });

  it("is idempotent", async () => {
    const { derived } = openFixture();
    const { preset, official } = await modernBuilds();
    derived.ensureFormats([preset, official]);
    const tables = [
      "formats",
      "format_pool",
      "default_printing",
      "card_names",
      "card_meta",
    ];
    const before = tables.map((t) =>
      count(derived, `SELECT COUNT(*) n FROM ${t}`),
    );
    derived.buildBase();
    derived.ensureFormats([preset, official]);
    const after = tables.map((t) =>
      count(derived, `SELECT COUNT(*) n FROM ${t}`),
    );
    expect(after).toEqual(before);
    derived.close();
  });

  it("keeps rows across a reopen of the same tool schema", async () => {
    const { derived, dir, mtg } = openFixture();
    const { preset } = await modernBuilds();
    derived.ensureFormats([preset]);
    derived.close();
    const again = Derived.open({
      derivedPath: join(dir, "derived", "d.sqlite"),
      mtgjsonPath: mtg,
    });
    expect(again.hasFormat(preset.key)).toBe(true);
    again.close();
  });

  it("deletes and rebuilds a file with another tool_schema", async () => {
    const { derived, dir, mtg } = openFixture();
    const { preset } = await modernBuilds();
    derived.ensureFormats([preset]);
    derived.db
      .prepare("UPDATE meta SET value = 'old' WHERE key = 'tool_schema'")
      .run();
    derived.close();
    const again = Derived.open({
      derivedPath: join(dir, "derived", "d.sqlite"),
      mtgjsonPath: mtg,
    });
    expect(again.getMeta("tool_schema")).toBe(TOOL_SCHEMA);
    expect(again.formatKeys()).toEqual([]);
    expect(count(again, "SELECT COUNT(*) n FROM card_names")).toBe(0);
    again.buildBase();
    expect(count(again, "SELECT COUNT(*) n FROM card_names")).toBeGreaterThan(
      100,
    );
    again.close();
  });

  it("replaces a file that is not a database", () => {
    const dir = tempDir();
    const mtg = copyFixture(join(dir, "mtg"));
    const path = join(dir, "d.sqlite");
    writeFileSync(
      path,
      "this is not a database, but it is long enough to be read".repeat(50),
    );
    const d = Derived.open({ derivedPath: path, mtgjsonPath: mtg });
    expect(d.getMeta("tool_schema")).toBe(TOOL_SCHEMA);
    d.close();
  });

  it("prunes formats that are no longer used", async () => {
    const { derived } = openFixture();
    const { preset, official } = await modernBuilds();
    derived.ensureFormats([preset, official]);
    derived.pruneFormats([official.key]);
    expect(derived.formatKeys()).toEqual([OFFICIAL_MODERN]);
    expect(count(derived, "SELECT COUNT(*) n FROM format_pool")).toBe(0);
    expect(
      count(
        derived,
        "SELECT COUNT(*) n FROM default_printing WHERE format_key = ?",
        preset.key,
      ),
    ).toBe(0);
    derived.pruneFormats([]);
    expect(derived.formatKeys()).toEqual([]);
    derived.close();
  });

  it("needs a definition for a custom format", () => {
    const { derived } = openFixture();
    expect(() =>
      derived.ensureFormats([{ key: "preset:x@1#000000000000", def: null }]),
    ).toThrow(/needs its definition/);
    expect(derived.hasFormat("preset:x@1#000000000000")).toBe(false);
    derived.close();
  });

  it("attaches MTGJSON read-only and leaves the file unchanged", async () => {
    const { derived, mtg } = openFixture();
    const hash = (): string =>
      createHash("sha256").update(readFileSync(mtg)).digest("hex");
    const before = hash();
    const { preset, official } = await modernBuilds();
    derived.ensureFormats([preset, official]);
    expect(() => derived.db.exec("CREATE TABLE mtg.x (a)")).toThrow(/readonly/);
    expect(() => derived.db.exec("DELETE FROM mtg.cards")).toThrow(/readonly/);
    derived.close();
    expect(hash()).toBe(before);
  });

  it("explains an attach that cannot work", () => {
    const dir = tempDir();
    expect(() =>
      Derived.open({
        derivedPath: join(dir, "d.sqlite"),
        mtgjsonPath: join(dir, "missing", "AllPrintings.sqlite"),
      }),
    ).toThrow(/cannot attach/);
  });

  it("escapes URI characters in a path", () => {
    expect(fileUri("/a b/c%d?e#f.sqlite", "?mode=ro")).toBe(
      "file:/a b/c%25d%3Fe%23f.sqlite?mode=ro",
    );
    const dir = tempDir();
    const mtg = copyFixture(join(dir, "odd %dir#1"));
    const d = Derived.open({
      derivedPath: join(dir, "d.sqlite"),
      mtgjsonPath: mtg,
    });
    expect(d.queries.cardCount()).toBe(116);
    d.close();
    // A plain connection can read the same file.
    const plain = new Database(mtg, { readonly: true });
    plain.close();
  });
});
