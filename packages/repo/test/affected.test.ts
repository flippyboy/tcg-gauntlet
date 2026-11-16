import { describe, expect, it } from "vitest";
import { affectedDecks } from "../src/index.js";
import type { Change, RepoContents } from "../src/index.js";

const deck = (
  folder: string,
  name: string,
): { path: string; name: string; text: string } => ({
  path: `${folder}/${name}.txt`,
  name,
  text: "",
});

const contents: RepoContents = {
  gauntlets: [
    {
      folder: "a",
      yamlText: "name: A\nformat: preset:2015-modern@1\n",
      decks: [deck("a", "One"), deck("a", "Two")],
    },
    {
      folder: "b",
      yamlText: "name: B\nformat: repo:formats/cube.yaml\n",
      decks: [deck("b", "Three"), deck("b", "Four ★")],
    },
    {
      folder: "c",
      yamlText: "name: C\nformat: repo:formats/cube.yaml\n",
      decks: [deck("c", "Five")],
    },
    { folder: "d", yamlText: "{{ not yaml", decks: [deck("d", "Six")] },
  ],
  formats: [],
  errors: [],
};

const sel = (...changes: Change[]): string[] =>
  affectedDecks(changes, contents);

describe("affectedDecks", () => {
  it("selects the deck for a changed .txt or primer .md", () => {
    expect(sel({ status: "M", path: "a/One.txt" })).toEqual(["a/One.txt"]);
    expect(sel({ status: "A", path: "b/Four ★.md" })).toEqual(["b/Four ★.txt"]);
  });

  it("selects the new path of a rename and ignores the old one", () => {
    expect(
      sel({ status: "R", path: "a/Two.txt", oldPath: "a/Old.txt" }),
    ).toEqual(["a/Two.txt"]);
    expect(
      sel({ status: "R", path: "a/Two.md", oldPath: "a/Gone.md" }),
    ).toEqual(["a/Two.txt"]);
  });

  it("selects every deck of a gauntlet when gauntlet.yaml or gauntlet.md changes", () => {
    expect(sel({ status: "M", path: "a/gauntlet.yaml" })).toEqual([
      "a/One.txt",
      "a/Two.txt",
    ]);
    expect(sel({ status: "A", path: "b/gauntlet.md" })).toEqual([
      "b/Four ★.txt",
      "b/Three.txt",
    ]);
  });

  it("selects the decks of every gauntlet that uses a changed format file", () => {
    expect(sel({ status: "M", path: "formats/cube.yaml" })).toEqual([
      "b/Four ★.txt",
      "b/Three.txt",
      "c/Five.txt",
    ]);
    expect(sel({ status: "M", path: "formats/other.yaml" })).toEqual([]);
    expect(sel({ status: "M", path: "formats/readme.md" })).toEqual([]);
  });

  it("selects nothing for a deleted deck or gauntlet file on its own", () => {
    expect(
      sel(
        { status: "D", path: "a/One.txt" },
        { status: "D", path: "a/gauntlet.yaml" },
        { status: "D", path: "formats/other.yaml" },
      ),
    ).toEqual([]);
  });

  it("selects every deck still using a deleted format file", () => {
    expect(sel({ status: "D", path: "formats/cube.yaml" })).toEqual([
      "b/Four ★.txt",
      "b/Three.txt",
      "c/Five.txt",
    ]);
  });

  it("combines changes without duplicates, in byte order", () => {
    expect(
      sel(
        { status: "M", path: "c/Five.txt" },
        { status: "M", path: "a/Two.txt" },
        { status: "M", path: "a/Two.md" },
        { status: "M", path: "a/gauntlet.md" },
        { status: "D", path: "a/One.txt" },
      ),
    ).toEqual(["a/One.txt", "a/Two.txt", "c/Five.txt"]);
  });

  it("ignores files that are not part of any deck", () => {
    expect(
      sel(
        { status: "A", path: "a/Unknown.txt" }, // not in the scanned contents
        { status: "M", path: "a/gauntlet.txt" },
        { status: "M", path: "a/sub/One.txt" },
        { status: "M", path: "zzz/One.txt" },
        { status: "M", path: "README.md" },
        { status: "M", path: "a/notes.csv" },
        { status: "M", path: ".github/workflows/x.yml" },
      ),
    ).toEqual([]);
  });
});
