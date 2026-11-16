import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeCardLookup, fakeLookup } from "../../conformance/src/index.js";
import type { FixtureCard, FixtureData } from "../../conformance/src/index.js";
import {
  formatKey,
  parseDeck,
  parseFormatDef,
  type FormatDef,
  type ParsedDeck,
} from "../src/index.js";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixturesDir = `${repoRoot}conformance/fixtures/`;

export const lookup: FakeCardLookup = fakeLookup(`${fixturesDir}cards.json`);

export const read = (path: string): string =>
  readFileSync(repoRoot + path, "utf8");

export function parseDef(yaml: string): FormatDef {
  const r = parseFormatDef(yaml, "format.yaml");
  if (r.def === null) throw new Error(JSON.stringify(r.violations));
  return r.def;
}

/** A custom format over a few sets. `extra` is more YAML after the required fields. */
export function tinyFormat(
  extra = "",
  sets = "[M10, M11, M15, KTK, NPH]",
): FormatDef {
  return parseDef(
    `schema_version: 1\nid: tiny\nname: Tiny\nlegality_by: name\nsets: ${sets}\n${extra}`,
  );
}

export async function registered(
  def: FormatDef,
  ref = "repo:formats/tiny.yaml",
): Promise<string> {
  const key = await formatKey(ref, def);
  lookup.registerFormat(key, def);
  return key;
}

export function deck(text: string, path = "deck.txt"): ParsedDeck {
  return parseDeck(text, path);
}

let n = 0;
/** A printing row for synthetic fixtures. */
export function row(over: Partial<FixtureCard>): FixtureCard {
  n++;
  return {
    uuid: `u${String(n).padStart(4, "0")}`,
    name: "Test Card",
    faceName: null,
    side: null,
    setCode: "AAA",
    number: "1",
    language: "English",
    availability: "mtgo, paper",
    isFunny: null,
    isOnlineOnly: null,
    isOversized: null,
    isPromo: null,
    originalReleaseDate: null,
    layout: "normal",
    types: "Creature",
    supertypes: null,
    manaValue: 1,
    text: null,
    scryfallId: null,
    legalities: {},
    ...over,
  };
}

export function synthetic(
  cards: FixtureCard[],
  sets: { code: string; releaseDate: string; type: string }[],
): FakeCardLookup {
  const data: FixtureData = {
    mtgjson: { version: "test", date: null },
    sets: sets.map((s) => ({ ...s, name: s.code })),
    cards,
  };
  return new FakeCardLookup(data);
}
