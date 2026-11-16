import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyRetention,
  derivedPath,
  entryFor,
  markCorrupt,
  mtgjsonPath,
  promote,
  readCurrent,
  sha256File,
  verifyCurrent,
  versionDirName,
  writeFileAtomic,
} from "../src/index.js";
import { tempDir } from "./helpers.js";

/** Writes a version's files, as a refresh would. */
function install(
  dataDir: string,
  version: string,
  date: string,
  content = "data",
) {
  const sha = "0".repeat(64);
  const e = entryFor(version, date, sha);
  mkdirSync(join(dataDir, e.path, ".."), { recursive: true });
  writeFileSync(mtgjsonPath(dataDir, e), content);
  mkdirSync(join(dataDir, "derived"), { recursive: true });
  writeFileSync(derivedPath(dataDir, e), "derived");
  return e;
}

describe("cache layout", () => {
  it("turns + into _ in directory names", () => {
    expect(versionDirName("5.3.0+20261115", "2026-11-15")).toBe(
      "5.3.0_20261115-2026-11-15",
    );
    const e = entryFor("5.3.0+20261115", "2026-11-15", "ab");
    expect(e.path).toBe(
      "mtgjson/5.3.0_20261115-2026-11-15/AllPrintings.sqlite",
    );
    expect(derivedPath("/d", e)).toBe(
      "/d/derived/5.3.0_20261115-2026-11-15.sqlite",
    );
  });
});

describe("writeFileAtomic", () => {
  it("writes, replaces and leaves no temporary file", async () => {
    const dir = tempDir();
    const file = join(dir, "sub", "x.json");
    await writeFileAtomic(file, "one");
    await writeFileAtomic(file, new TextEncoder().encode("two"));
    expect(readFileSync(file, "utf8")).toBe("two");
    expect(readdirSync(join(dir, "sub"))).toEqual(["x.json"]);
  });
});

describe("current.json and retention", () => {
  it("is null when there is no index, and rejects a damaged one", async () => {
    const dir = tempDir();
    expect(await readCurrent(dir)).toBeNull();
    expect(await markCorrupt(dir)).toBeNull();
    mkdirSync(join(dir, "mtgjson"));
    writeFileSync(join(dir, "mtgjson", "current.json"), '{"version": 1}');
    await expect(readCurrent(dir)).rejects.toThrow(/unexpected shape/);
    writeFileSync(join(dir, "mtgjson", "current.json"), "not json");
    await expect(readCurrent(dir)).rejects.toThrow();
  });

  it("keeps the current and previous versions and deletes the rest", async () => {
    const dir = tempDir();
    const a = install(dir, "5.1.0+1", "2026-01-01");
    expect((await promote(dir, a)).previous).toBeNull();
    const b = install(dir, "5.2.0+2", "2026-02-01");
    expect((await promote(dir, b)).previous).toMatchObject({
      version: "5.1.0+1",
    });
    const c = install(dir, "5.3.0+3", "2026-03-01");
    const now = await promote(dir, c);
    expect(now).toMatchObject({
      version: "5.3.0+3",
      previous: { version: "5.2.0+2" },
    });
    expect(now.previous).not.toHaveProperty("previous");
    expect(readdirSync(join(dir, "mtgjson")).sort()).toEqual([
      "5.2.0_2-2026-02-01",
      "5.3.0_3-2026-03-01",
      "current.json",
    ]);
    expect(readdirSync(join(dir, "derived")).sort()).toEqual([
      "5.2.0_2-2026-02-01.sqlite",
      "5.3.0_3-2026-03-01.sqlite",
    ]);
    expect(await readCurrent(dir)).toEqual(now);
  });

  it("keeps the old previous when the same version is installed again", async () => {
    const dir = tempDir();
    const a = install(dir, "5.1.0+1", "2026-01-01");
    await promote(dir, a);
    const b = install(dir, "5.2.0+2", "2026-02-01");
    await promote(dir, b);
    await markCorrupt(dir);
    const again = await promote(dir, b);
    expect(again.corrupt).toBeUndefined();
    expect(again.previous).toMatchObject({ version: "5.1.0+1" });
  });

  it("leaves SQLite journals of kept files alone", async () => {
    const dir = tempDir();
    const a = install(dir, "5.1.0+1", "2026-01-01");
    writeFileSync(`${derivedPath(dir, a)}-journal`, "j");
    writeFileSync(join(dir, "derived", "stale.sqlite"), "x");
    await applyRetention(dir, { ...a, previous: null });
    expect(readdirSync(join(dir, "derived")).sort()).toEqual([
      "5.1.0_1-2026-01-01.sqlite",
      "5.1.0_1-2026-01-01.sqlite-journal",
    ]);
    // A data directory with no mtgjson or derived folder is fine.
    await applyRetention(tempDir(), { ...a, previous: null });
  });
});

describe("startup checksum check", () => {
  it("accepts a good file, and marks a changed or missing one corrupt", async () => {
    const dir = tempDir();
    const e = install(dir, "5.1.0+1", "2026-01-01", "good bytes");
    const sha = await sha256File(mtgjsonPath(dir, e));
    const index = await promote(dir, { ...e, sha256: sha });
    expect(await verifyCurrent(dir, index)).toEqual({ ok: true });
    expect((await readCurrent(dir))?.corrupt).toBeUndefined();

    writeFileSync(mtgjsonPath(dir, e), "good bytez");
    expect(await verifyCurrent(dir, index)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect((await readCurrent(dir))?.corrupt).toBe(true);

    // Already marked: a second check does not need to write again.
    const marked = (await readCurrent(dir))!;
    expect(await verifyCurrent(dir, marked)).toEqual({
      ok: false,
      reason: "mismatch",
    });

    const gone = install(dir, "5.2.0+2", "2026-02-01", "second");
    const idx2 = await promote(dir, gone);
    expect(existsSync(mtgjsonPath(dir, gone))).toBe(true);
    writeFileSync(mtgjsonPath(dir, gone), "");
    expect(await verifyCurrent(dir, idx2)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    const missing = { ...idx2, path: "mtgjson/nope/AllPrintings.sqlite" };
    expect(await verifyCurrent(dir, missing)).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
