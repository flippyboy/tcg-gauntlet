import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import {
  type FormatDef,
  formatKey,
  parseFormatDef,
} from "@tcg-gauntlet/engine";
import { Derived, type FormatBuild } from "../src/index.js";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixturesDir = `${repoRoot}conformance/fixtures/`;
export const miniFixture = `${fixturesDir}mini-allprintings.sqlite`;

/** The MTGJSON version the committed fixtures were built from, as cards.json records it. */
export const fixtureVersion = (
  JSON.parse(readFileSync(`${fixturesDir}cards.json`, "utf8")) as {
    mtgjson: { version: string };
  }
).mtgjson.version;

const dirs: string[] = [];

/** A fresh temporary directory, removed after the test. */
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "carddata-test-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the committed mini fixture, which a test never modifies. */
export function copyFixture(dir = tempDir()): string {
  mkdirSync(dir, { recursive: true });
  const to = join(dir, "AllPrintings.sqlite");
  copyFileSync(miniFixture, to);
  return to;
}

export function openFixture(): { derived: Derived; dir: string; mtg: string } {
  const dir = tempDir();
  const mtg = copyFixture(join(dir, "mtg"));
  const derived = Derived.open({
    derivedPath: join(dir, "derived", "d.sqlite"),
    mtgjsonPath: mtg,
  });
  return { derived, dir, mtg };
}

export function loadPreset(): FormatDef {
  const r = parseFormatDef(
    readFileSync(`${repoRoot}presets/2015-modern@1.yaml`, "utf8"),
    "presets/2015-modern@1.yaml",
  );
  if (r.def === null) throw new Error(JSON.stringify(r.violations));
  return r.def;
}

export const OFFICIAL_MODERN = "official:modern#mtgjson";

export async function modernBuilds(): Promise<{
  preset: FormatBuild;
  official: FormatBuild;
}> {
  const def = loadPreset();
  return {
    preset: { key: await formatKey("preset:2015-modern@1", def), def },
    official: { key: OFFICIAL_MODERN, def: null },
  };
}
