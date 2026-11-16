import { lstat, readFile, readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import {
  MAX_FILE_BYTES,
  compareCodePoints,
  violation,
} from "@tcg-gauntlet/engine";
import type { Violation } from "@tcg-gauntlet/engine";
import type {
  DeckFile,
  FormatFile,
  GauntletContents,
  RepoContents,
} from "./types.js";

/** Decks per gauntlet (spec/gauntlet.md, Limits). */
export const MAX_DECKS_PER_GAUNTLET = 200;

interface Scanner {
  dir: string;
  errors: Violation[];
}

const limit = (s: Scanner, file: string, message: string): void => {
  s.errors.push(violation("E-LIMIT-EXCEEDED", file, message));
};

/** Reads a file by relative path. Null, with an error recorded, when it is refused. */
async function readLimited(
  s: Scanner,
  rel: string,
  st: Stats,
): Promise<string | null> {
  if (st.isSymbolicLink()) {
    limit(s, rel, "Symlinks are not allowed");
    return null;
  }
  if (st.size > MAX_FILE_BYTES) {
    limit(s, rel, `The file is larger than ${MAX_FILE_BYTES / 1024} KB`);
    return null;
  }
  return readFile(join(s.dir, rel), "utf8");
}

const byName = (a: { name: string }, b: { name: string }): number =>
  compareCodePoints(a.name, b.name);

async function listDir(abs: string): Promise<{ name: string; st: Stats }[]> {
  const names = await readdir(abs);
  const out: { name: string; st: Stats }[] = [];
  for (const name of names)
    out.push({ name, st: await lstat(join(abs, name)) });
  return out.sort(byName);
}

async function scanFormats(s: Scanner): Promise<FormatFile[]> {
  const formats: FormatFile[] = [];
  let entries: { name: string; st: Stats }[];
  try {
    const top = await lstat(join(s.dir, "formats"));
    if (top.isSymbolicLink()) {
      limit(s, "formats", "Symlinks are not allowed");
      return formats;
    }
    if (!top.isDirectory()) return formats;
    entries = await listDir(join(s.dir, "formats"));
  } catch {
    return formats; // no formats/ folder
  }
  for (const { name, st } of entries) {
    if (!name.endsWith(".yaml")) continue;
    const rel = `formats/${name}`;
    if (!st.isSymbolicLink() && !st.isFile()) continue;
    const text = await readLimited(s, rel, st);
    if (text !== null) formats.push({ path: rel, text });
  }
  return formats;
}

async function scanGauntlet(
  s: Scanner,
  folder: string,
): Promise<GauntletContents | null> {
  const entries = await listDir(join(s.dir, folder));
  const yaml = entries.find((e) => e.name === "gauntlet.yaml");
  if (yaml === undefined) return null;
  const yamlRel = `${folder}/gauntlet.yaml`;
  if (!yaml.st.isSymbolicLink() && !yaml.st.isFile()) return null;
  const yamlText = await readLimited(s, yamlRel, yaml.st);
  // A gauntlet whose gauntlet.yaml cannot be read is not scanned further.
  if (yamlText === null) return null;

  const g: GauntletContents = { folder, yamlText, decks: [] };
  const txtNames = new Set<string>();
  const mdFiles = new Map<string, string>();
  const decks: { name: string; st: Stats }[] = [];

  for (const { name, st } of entries) {
    if (!st.isSymbolicLink() && !st.isFile()) continue; // subfolders and specials are ignored
    const rel = `${folder}/${name}`;
    if (name === "gauntlet.md") {
      const text = await readLimited(s, rel, st);
      if (text !== null) g.mdText = text;
    } else if (name.endsWith(".txt") && name !== "gauntlet.txt") {
      txtNames.add(name.slice(0, -4));
      decks.push({ name: name.slice(0, -4), st });
    } else if (name.endsWith(".md")) {
      const text = await readLimited(s, rel, st);
      if (text !== null) mdFiles.set(name.slice(0, -3), text);
    }
  }

  // Name collisions: the same name in lower case. The first path in byte order stays.
  const firstOf = new Map<string, string>();
  const kept: { name: string; st: Stats }[] = [];
  for (const d of decks) {
    const key = d.name.toLowerCase();
    if (firstOf.has(key)) {
      limit(
        s,
        `${folder}/${d.name}.txt`,
        `The deck name collides with ${firstOf.get(key) ?? ""}.txt when letter case is ignored`,
      );
    } else {
      firstOf.set(key, d.name);
      kept.push(d);
    }
  }

  // Deck count: keep the first 200 in byte order.
  if (decks.length > MAX_DECKS_PER_GAUNTLET) {
    limit(
      s,
      yamlRel,
      `The gauntlet has ${decks.length} decks. The most allowed is ${MAX_DECKS_PER_GAUNTLET}`,
    );
  }
  for (const d of kept.slice(0, MAX_DECKS_PER_GAUNTLET)) {
    const rel = `${folder}/${d.name}.txt`;
    const text = await readLimited(s, rel, d.st);
    if (text === null) continue;
    const deck: DeckFile = { path: rel, name: d.name, text };
    const primer = mdFiles.get(d.name);
    if (primer !== undefined) deck.primer = primer;
    g.decks.push(deck);
  }

  for (const name of [...mdFiles.keys()].sort(compareCodePoints)) {
    if (name !== "gauntlet" && !txtNames.has(name)) {
      s.errors.push(
        violation(
          "W-PRIMER-ORPHAN",
          `${folder}/${name}.md`,
          `There is no ${name}.txt next to this primer`,
        ),
      );
    }
  }
  return g;
}

/**
 * Reads a deck repo working tree (spec/gauntlet.md). Problems that do not stop
 * the scan are returned in `errors`: limits, symlinks and orphan primers.
 * Files over a limit are left out of the contents.
 */
export async function scanRepo(dir: string): Promise<RepoContents> {
  const s: Scanner = { dir, errors: [] };
  const gauntlets: GauntletContents[] = [];
  for (const { name, st } of await listDir(dir)) {
    if (name.startsWith(".") || name === "formats") continue;
    if (st.isSymbolicLink()) {
      // A link to a folder would be read as a gauntlet. A link to a file is never read.
      const target = await stat(join(dir, name)).catch(() => null);
      if (target?.isDirectory() === true)
        limit(s, name, "Symlinks are not allowed");
      continue;
    }
    if (!st.isDirectory()) continue;
    const g = await scanGauntlet(s, name);
    if (g !== null) gauntlets.push(g);
  }
  const formats = await scanFormats(s);
  return { gauntlets, formats, errors: s.errors };
}
