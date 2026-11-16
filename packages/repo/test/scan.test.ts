import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DECKS_PER_GAUNTLET, scanRepo } from "../src/index.js";
import { tmp, write } from "./helpers.js";

const YAML = "name: G\nformat: modern\n";
const codes = (r: Awaited<ReturnType<typeof scanRepo>>): string[] =>
  r.errors.map((e) => `${e.code} ${e.file}`);

describe("scanRepo layout", () => {
  it("finds gauntlets, decks, primers and formats, and ignores the rest", async () => {
    const d = tmp();
    write(d, "modern 2015/gauntlet.yaml", YAML);
    write(d, "modern 2015/gauntlet.md", "About\n");
    write(d, "modern 2015/Burn.txt", "4 Lightning Bolt\n");
    write(d, "modern 2015/Burn.md", "Primer\n");
    write(d, "modern 2015/日本語 deck.txt", "4 Island\n");
    write(d, "modern 2015/gauntlet.txt", "reserved\n");
    write(d, "modern 2015/notes.csv", "ignored\n");
    write(d, "modern 2015/sub/Nested.txt", "ignored\n");
    mkdirSync(join(d, "modern 2015/dir.txt"));
    write(d, "Épique/gauntlet.yaml", YAML);
    write(d, "no gauntlet/Deck.txt", "ignored\n");
    write(d, ".github/gauntlet.yaml", YAML);
    write(d, ".hidden/gauntlet.yaml", YAML);
    write(d, "README.md", "root\n");
    write(d, "formats/cube.yaml", "id: cube\n");
    write(d, "formats/README.md", "ignored\n");
    write(d, "formats/sub/other.yaml", "ignored\n");
    const r = await scanRepo(d);
    expect(r.errors).toEqual([]);
    expect(r.gauntlets.map((g) => g.folder)).toEqual(["modern 2015", "Épique"]);
    const g = r.gauntlets[0];
    expect(g?.yamlText).toBe(YAML);
    expect(g?.mdText).toBe("About\n");
    expect(g?.decks).toEqual([
      {
        path: "modern 2015/Burn.txt",
        name: "Burn",
        text: "4 Lightning Bolt\n",
        primer: "Primer\n",
      },
      {
        path: "modern 2015/日本語 deck.txt",
        name: "日本語 deck",
        text: "4 Island\n",
      },
    ]);
    expect(r.gauntlets[1]?.decks).toEqual([]);
    expect(r.gauntlets[1]?.mdText).toBeUndefined();
    expect(r.formats).toEqual([
      { path: "formats/cube.yaml", text: "id: cube\n" },
    ]);
  });

  it("does not treat a folder named formats as a gauntlet", async () => {
    const d = tmp();
    write(d, "formats/gauntlet.yaml", YAML);
    write(d, "formats/Deck.txt", "x\n");
    const r = await scanRepo(d);
    expect(r.gauntlets).toEqual([]);
    expect(r.formats.map((f) => f.path)).toEqual(["formats/gauntlet.yaml"]); // read as a format file only
  });

  it("returns nothing for an empty repo", async () => {
    expect(await scanRepo(tmp())).toEqual({
      gauntlets: [],
      formats: [],
      errors: [],
    });
  });

  it("warns about a primer with no deck, but never about gauntlet.md", async () => {
    const d = tmp();
    write(d, "g/gauntlet.yaml", YAML);
    write(d, "g/gauntlet.md", "x\n");
    write(d, "g/Lonely.md", "x\n");
    write(d, "g/Deck.txt", "x\n");
    write(d, "g/Deck.md", "x\n");
    const r = await scanRepo(d);
    expect(r.errors).toMatchObject([
      { code: "W-PRIMER-ORPHAN", severity: "warning", file: "g/Lonely.md" },
    ]);
  });
});

describe("scanRepo limits", () => {
  const big = (n: number): string => "x".repeat(n);

  it("refuses files over 256 KB and keeps files of exactly 256 KB", async () => {
    const d = tmp();
    write(d, "g/gauntlet.yaml", YAML);
    write(d, "g/gauntlet.md", big(262145));
    write(d, "g/Big.txt", big(262145));
    write(d, "g/Edge.txt", big(262144));
    write(d, "g/Primer.txt", "x\n");
    write(d, "g/Primer.md", big(262145));
    write(d, "formats/huge.yaml", big(262145));
    write(d, "formats/ok.yaml", "id: ok\n");
    const r = await scanRepo(d);
    expect(codes(r).sort()).toEqual(
      [
        "E-LIMIT-EXCEEDED g/Big.txt",
        "E-LIMIT-EXCEEDED g/Primer.md",
        "E-LIMIT-EXCEEDED g/gauntlet.md",
        "E-LIMIT-EXCEEDED formats/huge.yaml",
      ].sort(),
    );
    const g = r.gauntlets[0];
    expect(g?.mdText).toBeUndefined();
    expect(g?.decks.map((x) => x.name)).toEqual(["Edge", "Primer"]);
    expect(g?.decks[1]?.primer).toBeUndefined();
    expect(r.formats.map((f) => f.path)).toEqual(["formats/ok.yaml"]);
  });

  it("drops a gauntlet whose gauntlet.yaml is too large", async () => {
    const d = tmp();
    write(d, "g/gauntlet.yaml", big(262145));
    write(d, "g/Deck.txt", "x\n");
    const r = await scanRepo(d);
    expect(r.gauntlets).toEqual([]);
    expect(codes(r)).toEqual(["E-LIMIT-EXCEEDED g/gauntlet.yaml"]);
  });

  it("keeps the first 200 decks in byte order and reports the rest", async () => {
    const d = tmp();
    write(d, "g/gauntlet.yaml", YAML);
    for (let i = 0; i < MAX_DECKS_PER_GAUNTLET + 1; i++)
      write(d, `g/d${String(i).padStart(3, "0")}.txt`, "x\n");
    const r = await scanRepo(d);
    expect(codes(r)).toEqual(["E-LIMIT-EXCEEDED g/gauntlet.yaml"]);
    const names = r.gauntlets[0]?.decks.map((x) => x.name) ?? [];
    expect(names).toHaveLength(MAX_DECKS_PER_GAUNTLET);
    expect(names[0]).toBe("d000");
    expect(names.at(-1)).toBe("d199");
  });

  it("accepts exactly 200 decks", async () => {
    const d = tmp();
    write(d, "g/gauntlet.yaml", YAML);
    for (let i = 0; i < MAX_DECKS_PER_GAUNTLET; i++)
      write(d, `g/d${i}.txt`, "x\n");
    const r = await scanRepo(d);
    expect(r.errors).toEqual([]);
    expect(r.gauntlets[0]?.decks).toHaveLength(200);
  });

  it("reports names that collide in lower case on all but the first path in byte order", async () => {
    const d = tmp();
    write(d, "g/gauntlet.yaml", YAML);
    write(d, "g/Burn.txt", "1\n");
    write(d, "g/burn.txt", "2\n");
    write(d, "g/BURN.txt", "3\n");
    write(d, "g/burn.md", "primer\n");
    write(d, "g/Other.txt", "4\n");
    const r = await scanRepo(d);
    expect(codes(r).sort()).toEqual([
      "E-LIMIT-EXCEEDED g/Burn.txt",
      "E-LIMIT-EXCEEDED g/burn.txt",
    ]);
    expect(r.gauntlets[0]?.decks.map((x) => x.name)).toEqual(["BURN", "Other"]);
    expect(r.errors.some((e) => e.code === "W-PRIMER-ORPHAN")).toBe(false);
  });
});

describe("scanRepo symlinks", () => {
  it("refuses symlinks among the files a tool would read", async () => {
    const d = tmp();
    const outside = tmp();
    write(outside, "secret.txt", "secret\n");
    write(outside, "other/gauntlet.yaml", YAML);
    write(d, "g/gauntlet.yaml", YAML);
    write(d, "g/Real.txt", "x\n");
    symlinkSync(join(outside, "secret.txt"), join(d, "g/Linked.txt"));
    symlinkSync(join(outside, "secret.txt"), join(d, "g/Linked.md"));
    symlinkSync(join(outside, "secret.txt"), join(d, "g/gauntlet.md"));
    symlinkSync(join(outside, "secret.txt"), join(d, "g/ignored.csv"));
    symlinkSync(join(outside, "other"), join(d, "g/sub"));
    symlinkSync(join(d, "g/nowhere.txt"), join(d, "g/Dangling.txt"));
    symlinkSync(join(outside, "other"), join(d, "linked-gauntlet"));
    symlinkSync(join(outside, "secret.txt"), join(d, "linked-file"));
    symlinkSync(join(d, "missing"), join(d, "dangling-top"));
    mkdirSync(join(d, "formats"));
    symlinkSync(join(outside, "secret.txt"), join(d, "formats/x.yaml"));
    write(d, "formats/y.yaml", "id: y\n");
    mkdirSync(join(d, "h"));
    symlinkSync(join(outside, "secret.txt"), join(d, "h/gauntlet.yaml"));
    write(d, "h/Deck.txt", "x\n");
    const r = await scanRepo(d);
    expect(codes(r).sort()).toEqual(
      [
        "E-LIMIT-EXCEEDED g/Linked.txt",
        "E-LIMIT-EXCEEDED g/Linked.md",
        "E-LIMIT-EXCEEDED g/gauntlet.md",
        "E-LIMIT-EXCEEDED g/Dangling.txt",
        "E-LIMIT-EXCEEDED linked-gauntlet",
        "E-LIMIT-EXCEEDED formats/x.yaml",
        "E-LIMIT-EXCEEDED h/gauntlet.yaml",
      ].sort(),
    );
    expect(r.gauntlets.map((g) => g.folder)).toEqual(["g"]);
    expect(r.gauntlets[0]?.decks.map((x) => x.name)).toEqual(["Real"]);
    expect(r.formats.map((f) => f.path)).toEqual(["formats/y.yaml"]);
  });

  it("refuses a symlinked formats folder", async () => {
    const d = tmp();
    const outside = tmp();
    write(outside, "a.yaml", "id: a\n");
    symlinkSync(outside, join(d, "formats"));
    const r = await scanRepo(d);
    expect(codes(r)).toEqual(["E-LIMIT-EXCEEDED formats"]);
    expect(r.formats).toEqual([]);
  });

  it("ignores a formats entry that is a file", async () => {
    const d = tmp();
    writeFileSync(join(d, "formats"), "not a folder\n");
    expect((await scanRepo(d)).formats).toEqual([]);
  });
});
