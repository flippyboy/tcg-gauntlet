import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isFormatFailure, resolveFormat } from "../src/index.js";
import type { FormatResolution } from "../src/index.js";
import { tmp, write } from "./helpers.js";

const presets = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../presets",
);
const known = (names: string[]) => ({
  findCard: (n: string) => (names.includes(n) ? ({ name: n } as never) : null),
});
const anyCard = { findCard: (n: string) => ({ name: n }) as never };

const CUBE = `schema_version: 1
id: cube
name: Cube
legality_by: name
sets: [M15]
banned: [Black Lotus]
`;

const saved = process.env["PRESETS_DIR"];
afterEach(() => {
  if (saved === undefined) delete process.env["PRESETS_DIR"];
  else process.env["PRESETS_DIR"] = saved;
});

const failure = (r: FormatResolution): string[] => {
  if (!isFormatFailure(r)) throw new Error("expected a failure");
  return r.violations.map((v) => `${v.code} ${v.file}`);
};

describe("resolveFormat", () => {
  it("resolves official formats, bare or prefixed, with the same key", async () => {
    const bare = await resolveFormat({ format: "modern" }, { formats: [] });
    const full = await resolveFormat(
      { format: "official:modern" },
      { formats: [] },
    );
    expect(isFormatFailure(bare)).toBe(false);
    if (isFormatFailure(bare) || isFormatFailure(full)) return;
    expect(bare.key).toBe("official:modern#mtgjson");
    expect(full.key).toBe(bare.key);
    expect(bare.def).toBeNull();
    expect(bare.ref).toEqual({
      kind: "official",
      ref: "official:modern",
      name: "modern",
    });
    expect(bare.rules).toMatchObject({
      min_main: 60,
      max_sideboard: 15,
      max_copies: 4,
    });
  });

  it("loads a preset from presetsDir", async () => {
    const r = await resolveFormat(
      { format: "preset:2015-modern@1" },
      { formats: [] },
      { presetsDir: presets, lookup: anyCard },
    );
    if (isFormatFailure(r)) throw new Error(JSON.stringify(r));
    expect(r.key).toMatch(/^preset:2015-modern@1#[0-9a-f]{12}$/);
    expect(r.def?.id).toBe("2015-modern");
    expect(r.rules).toBe(r.def?.deck);
  });

  it("defaults presetsDir to PRESETS_DIR, and throws when there is none", async () => {
    process.env["PRESETS_DIR"] = presets;
    expect(
      isFormatFailure(
        await resolveFormat(
          { format: "preset:2015-modern@1" },
          { formats: [] },
        ),
      ),
    ).toBe(false);
    delete process.env["PRESETS_DIR"];
    await expect(
      resolveFormat({ format: "preset:2015-modern@1" }, { formats: [] }),
    ).rejects.toThrow(/PRESETS_DIR/);
    process.env["PRESETS_DIR"] = "";
    await expect(
      resolveFormat({ format: "preset:2015-modern@1" }, { formats: [] }),
    ).rejects.toThrow(/PRESETS_DIR/);
    // An official format needs no presets.
    delete process.env["PRESETS_DIR"];
    expect(
      isFormatFailure(
        await resolveFormat({ format: "pauper" }, { formats: [] }),
      ),
    ).toBe(false);
  });

  it("gives E-FORMAT-UNKNOWN for a preset the tool does not ship", async () => {
    const r = await resolveFormat(
      { format: "preset:nope@3" },
      { formats: [] },
      { presetsDir: presets, file: "g/gauntlet.yaml" },
    );
    expect(failure(r)).toEqual(["E-FORMAT-UNKNOWN g/gauntlet.yaml"]);
  });

  it("rethrows a read error that is not a missing file", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "afile"), "x");
    await expect(
      resolveFormat(
        { format: "preset:a@1" },
        { formats: [] },
        { presetsDir: join(dir, "afile") },
      ),
    ).rejects.toThrow();
  });

  it("gives E-FORMAT-INVALID when the preset id does not match the reference", async () => {
    const dir = tmp();
    write(dir, "other@1.yaml", CUBE);
    for (const lookup of [anyCard, undefined]) {
      const r = await resolveFormat(
        { format: "preset:other@1" },
        { formats: [] },
        { presetsDir: dir, ...(lookup ? { lookup } : {}) },
      );
      expect(failure(r)).toEqual(["E-FORMAT-INVALID presets/other@1.yaml"]);
    }
  });

  it("resolves a repo format and does not compare its id with the file name", async () => {
    const r = await resolveFormat(
      { format: "repo:formats/whatever.yaml" },
      { formats: [{ path: "formats/whatever.yaml", text: CUBE }] },
      { lookup: anyCard },
    );
    if (isFormatFailure(r)) throw new Error(JSON.stringify(r));
    expect(r.key).toMatch(/^repo:formats\/whatever\.yaml#[0-9a-f]{12}$/);
    expect(r.def?.banned).toEqual(["Black Lotus"]);
  });

  it("changes the key when the definition changes, not when only a comment does", async () => {
    const key = async (text: string): Promise<string> => {
      const r = await resolveFormat(
        { format: "repo:formats/c.yaml" },
        { formats: [{ path: "formats/c.yaml", text }] },
      );
      if (isFormatFailure(r)) throw new Error("failed");
      return r.key;
    };
    expect(await key(CUBE)).toBe(await key(`# comment\n${CUBE}`));
    expect(await key(CUBE)).not.toBe(await key(CUBE.replace("M15", "KTK")));
  });

  it("gives E-FORMAT-UNKNOWN for a missing repo file and for a path outside formats/", async () => {
    const missing = await resolveFormat(
      { format: "repo:formats/missing.yaml" },
      { formats: [] },
    );
    expect(failure(missing)).toEqual(["E-FORMAT-UNKNOWN gauntlet.yaml"]);
    for (const f of [
      "repo:other/cube.yaml",
      "repo:formats/../cube.yaml",
      "repo:cube.yaml",
      "repo:formats/sub/c.yaml",
      "bogus",
      "official:commander",
      "preset:x",
    ]) {
      const r = await resolveFormat(
        { format: f },
        { formats: [{ path: "other/cube.yaml", text: CUBE }] },
      );
      expect(failure(r), f).toEqual(["E-FORMAT-UNKNOWN gauntlet.yaml"]);
    }
  });

  it("returns the schema violations of an invalid definition", async () => {
    const r = await resolveFormat(
      { format: "repo:formats/c.yaml" },
      { formats: [{ path: "formats/c.yaml", text: "id: BAD\nextra: 1\n" }] },
    );
    const f = failure(r);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x === "E-SCHEMA-INVALID formats/c.yaml")).toBe(true);
  });

  it("checks card names when a lookup is given", async () => {
    const formats = [{ path: "formats/c.yaml", text: CUBE }];
    const bad = await resolveFormat(
      { format: "repo:formats/c.yaml" },
      { formats },
      { lookup: known([]) },
    );
    expect(failure(bad)).toEqual(["E-FORMAT-INVALID formats/c.yaml"]);
    const ok = await resolveFormat(
      { format: "repo:formats/c.yaml" },
      { formats },
      { lookup: known(["Black Lotus"]) },
    );
    expect(isFormatFailure(ok)).toBe(false);
    const skipped = await resolveFormat(
      { format: "repo:formats/c.yaml" },
      { formats },
    );
    expect(isFormatFailure(skipped)).toBe(false);
  });

  it("a deck repo cannot supply a preset", async () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const r = await resolveFormat(
      { format: "preset:cube@1" },
      { formats: [{ path: "formats/cube@1.yaml", text: CUBE }] },
      { presetsDir: dir },
    );
    expect(failure(r)).toEqual(["E-FORMAT-UNKNOWN gauntlet.yaml"]);
  });
});
