// The MTGJSON canary (.github/workflows/mtgjson-canary.yml), and a way to try a
// real refresh by hand.
//
//   node scripts/canary.ts refresh --data-dir <dir> [--base-url <url>]
//       Downloads the latest MTGJSON into <dir>, checks both checksums, runs the
//       self-check (20,000 card names or more), and builds the derived tables for the
//       2015 Modern preset and official:modern. Prints timings and file sizes.
//   node scripts/canary.ts conformance --data-dir <dir>
//       Runs the conformance corpus through SqliteCardLookup over the real data.
//
// Needs the package built (`pnpm build`) and Node 22.18 or newer.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runConformance } from "@tcg-gauntlet/conformance";
import { formatKey, parseFormatDef } from "@tcg-gauntlet/engine";
import {
  type FormatBuild,
  derivedPath,
  mtgjsonPath,
  openCurrent,
  refreshCardData,
} from "../dist/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const MIB = 1024 * 1024;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "data-dir": { type: "string" },
    "base-url": { type: "string", default: "https://mtgjson.com/api/v5" },
  },
});
const [command] = positionals;
const dataDir = values["data-dir"];
if ((command !== "refresh" && command !== "conformance") || !dataDir) {
  console.error(
    "Usage: node scripts/canary.ts refresh|conformance --data-dir <dir> [--base-url <url>]",
  );
  process.exit(2);
}

async function formats(): Promise<{
  builds: FormatBuild[];
  presetKey: string;
}> {
  const file = "presets/2015-modern@1.yaml";
  const parsed = parseFormatDef(readFileSync(`${root}${file}`, "utf8"), file);
  if (parsed.def === null) throw new Error(JSON.stringify(parsed.violations));
  const presetKey = await formatKey("preset:2015-modern@1", parsed.def);
  return {
    presetKey,
    builds: [
      { key: presetKey, def: parsed.def },
      { key: "official:modern#mtgjson", def: null },
    ],
  };
}

const seconds = (from: number): string =>
  `${((performance.now() - from) / 1000).toFixed(2)} s`;

const { builds, presetKey } = await formats();

if (command === "refresh") {
  const t0 = performance.now();
  const r = await refreshCardData({
    baseUrl: values["base-url"] ?? "",
    dataDir,
    formatDefs: builds,
    force: true,
  });
  console.log(`refresh: ${r.status} in ${seconds(t0)}`);
  if (r.status !== "updated" || r.current === null) {
    console.error(`refresh failed: ${r.error?.kind}: ${r.error?.message}`);
    process.exit(1);
  }
  const size = (p: string): string =>
    `${(statSync(p).size / MIB).toFixed(1)} MiB`;
  console.log(`version: ${r.current.version} (${r.current.date})`);
  console.log(`AllPrintings.sqlite: ${size(mtgjsonPath(dataDir, r.current))}`);
  console.log(`derived: ${size(derivedPath(dataDir, r.current))}`);
  console.log(`path: ${r.current.path}`);
}

const t1 = performance.now();
const opened = await openCurrent(dataDir, { formatDefs: builds });
if (!opened.ok) {
  console.error(`cannot open the card data: ${opened.reason}`);
  process.exit(1);
}
console.log(`open (checksum, derived): ${seconds(t1)}`);
const { lookup } = opened;
console.log(`data version: ${lookup.dataVersion()}`);
console.log(`2015 Modern pool: ${lookup.poolSize(presetKey)} names`);

if (command === "conformance") {
  const t2 = performance.now();
  const mismatches = await runConformance(lookup, {
    casesDir: `${root}conformance/cases`,
    presetsDir: `${root}presets`,
  });
  console.log(`conformance: ${mismatches.length} mismatches in ${seconds(t2)}`);
  for (const m of mismatches)
    console.error(`${m.case} [${m.check}]: ${m.message}`);
  lookup.close();
  if (mismatches.length > 0) process.exit(1);
} else {
  lookup.close();
}
