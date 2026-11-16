// Builds the conformance fixtures from a real MTGJSON AllPrintings.sqlite:
//   conformance/fixtures/mini-allprintings.sqlite  same tables and columns, only
//                                                  the rows the cases need
//   conformance/fixtures/cards.json                the same data for the fake lookup
//
// Usage: node scripts/build-fixtures.ts --mtgjson <path to AllPrintings.sqlite>
// Needs Node 22.13 or newer (the built-in node:sqlite module; type stripping needs
// 22.18 or newer, or --experimental-strip-types before that).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = `${root}conformance/fixtures/`;

const { values } = parseArgs({
  options: { mtgjson: { type: "string" } },
});
if (values.mtgjson === undefined) {
  console.error(
    "Usage: node scripts/build-fixtures.ts --mtgjson <path to AllPrintings.sqlite>",
  );
  process.exit(2);
}

const names = readFileSync(`${fixtures}cards.txt`, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));
if (new Set(names).size !== names.length) {
  console.error("cards.txt has a repeated name");
  process.exit(1);
}

const src = new DatabaseSync(values.mtgjson, { readOnly: true });

type Row = Record<string, SQLInputValue>;
const all = (sql: string, ...args: SQLInputValue[]): Row[] =>
  src.prepare(sql).all(...args);

// The rows of every wanted card, in a fixed order.
const placeholders = names.map(() => "?").join(",");
const cards = all(
  `SELECT * FROM cards WHERE name IN (${placeholders}) ORDER BY name, setCode, number, uuid`,
  ...names,
);
const found = new Set(cards.map((c) => c["name"]));
const missing = names.filter((n) => !found.has(n));
if (missing.length > 0) {
  console.error(`Not in ${values.mtgjson}: ${missing.join(", ")}`);
  process.exit(1);
}
const uuids = cards.map((c) => c["uuid"] as string);
const setCodes = [...new Set(cards.map((c) => c["setCode"] as string))].sort();

const byUuid = (table: string): Row[] => {
  const out: Row[] = [];
  // Chunked, to stay under SQLite's variable limit.
  for (let i = 0; i < uuids.length; i += 500) {
    const chunk = uuids.slice(i, i + 500);
    out.push(
      ...all(
        `SELECT * FROM ${table} WHERE uuid IN (${chunk.map(() => "?").join(",")})`,
        ...chunk,
      ),
    );
  }
  return out.sort((a, b) =>
    (a["uuid"] as string).localeCompare(b["uuid"] as string, "en"),
  );
};
const identifiers = byUuid("cardIdentifiers");
const legalities = byUuid("cardLegalities");
const sets = all(
  `SELECT * FROM sets WHERE code IN (${setCodes.map(() => "?").join(",")}) ORDER BY code`,
  ...setCodes,
);
const meta = all("SELECT * FROM meta");

// ---------------------------------------------------------------- the sqlite file
mkdirSync(fixtures, { recursive: true });
const outPath = `${fixtures}mini-allprintings.sqlite`;
for (const suffix of ["", "-journal", "-wal", "-shm"])
  rmSync(outPath + suffix, { force: true });
const dst = new DatabaseSync(outPath);
dst.exec("PRAGMA journal_mode = DELETE");

const schema = all(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY (type = 'table') DESC, rowid",
);
for (const s of schema) dst.exec(s["sql"] as string);

const insert = (table: string, rows: Row[]): void => {
  const first = rows[0];
  if (first === undefined) return;
  const cols = Object.keys(first);
  const stmt = dst.prepare(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
  );
  for (const r of rows) stmt.run(...cols.map((c) => r[c] ?? null));
};
dst.exec("BEGIN");
insert("cards", cards);
insert("cardIdentifiers", identifiers);
insert("cardLegalities", legalities);
insert("sets", sets);
insert("meta", meta);
dst.exec("COMMIT");
dst.exec("VACUUM");
dst.close();

// ------------------------------------------------------------------- cards.json
const idByUuid = new Map(
  identifiers.map((r) => [r["uuid"], r["scryfallId"] ?? null]),
);
const legalByUuid = new Map(legalities.map((r) => [r["uuid"], r]));
const FORMATS = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
];
const pick = (r: Row, keys: string[]): Record<string, SQLInputValue> =>
  Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));

const jsonCards = cards.map((c) => ({
  ...pick(c, [
    "uuid",
    "name",
    "faceName",
    "side",
    "setCode",
    "number",
    "language",
    "availability",
    "isFunny",
    "isOnlineOnly",
    "isOversized",
    "isPromo",
    "originalReleaseDate",
    "layout",
    "types",
    "supertypes",
    "manaValue",
    "text",
  ]),
  scryfallId: idByUuid.get(c["uuid"]) ?? null,
  legalities: pick(legalByUuid.get(c["uuid"]) ?? {}, FORMATS),
}));
const jsonSets = sets.map((s) =>
  pick(s, ["code", "name", "releaseDate", "type"]),
);
const m = meta[0] ?? {};

const lines = [
  "{",
  `"mtgjson": ${JSON.stringify({ version: m["version"] ?? null, date: m["date"] ?? null })},`,
  '"sets": [',
  jsonSets.map((s) => JSON.stringify(s)).join(",\n"),
  "],",
  '"cards": [',
  jsonCards.map((c) => JSON.stringify(c)).join(",\n"),
  "]",
  "}",
  "",
];
writeFileSync(`${fixtures}cards.json`, lines.join("\n"));
console.log(
  `${cards.length} printings of ${names.length} cards, ${sets.length} sets, MTGJSON ${JSON.stringify(m["version"])}`,
);
if (!existsSync(outPath)) process.exit(1);
