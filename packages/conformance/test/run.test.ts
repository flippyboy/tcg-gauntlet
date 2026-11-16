import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeLookup, runConformance } from "../src/index.js";

const root = new URL("../../../", import.meta.url).pathname;
const lookup = fakeLookup(`${root}conformance/fixtures/cards.json`);
const presetsDir = `${root}presets`;

const tmp = mkdtempSync(join(tmpdir(), "conformance-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function makeCase(files: Record<string, string>, spec?: object): string {
  const dir = join(tmp, `set${++n}`);
  mkdirSync(join(dir, "case"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(dir, "case", name), text);
  if (spec) writeFileSync(join(dir, "case", "case.json"), JSON.stringify(spec));
  return dir;
}

const deck = `${"4 Lightning Bolt\n"}56 Mountain\n`;

async function run(files: Record<string, string>, spec?: object) {
  return runConformance(lookup, {
    casesDir: makeCase(files, spec),
    presetsDir,
  });
}

describe("runConformance", () => {
  it("passes on the committed corpus", async () => {
    expect(
      await runConformance(lookup, {
        casesDir: `${root}conformance/cases`,
        presetsDir,
      }),
    ).toEqual([]);
  });

  it("passes a case whose expectations are right", async () => {
    const out = await run(
      {
        "deck.txt": deck,
        "expected.mtgo.txt": "4 Lightning Bolt\r\n56 Mountain\r\n",
      },
      {
        format: "official:modern",
        expectedViolations: [],
        expectedPrintings: { "1": "LEA/161" },
      },
    );
    expect(out).toEqual([]);
  });

  it("reports violations that differ, with their lines", async () => {
    const out = await run(
      { "deck.txt": "4 Lightning Bolt\n" },
      {
        format: "official:modern",
        expectedViolations: [{ code: "E-CARD-UNKNOWN", line: 1 }],
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ case: "case", check: "violations" });
    expect(out[0]?.message).toBe(
      "expected [E-CARD-UNKNOWN@1] but got [E-DECK-MAIN-SIZE]",
    );
  });

  it("compares violations without a line, and in order", async () => {
    const out = await run(
      { "deck.txt": "4 Lightning Bolt\n" },
      {
        format: "official:modern",
        expectedViolations: [{ code: "E-DECK-MAIN-SIZE" }],
      },
    );
    expect(out).toEqual([]);
  });

  it("reports a printing that differs, including none", async () => {
    const out = await run(
      { "deck.txt": `${deck}1 Nonsense\n` },
      {
        format: "official:modern",
        expectedViolations: [{ code: "E-CARD-UNKNOWN", line: 3 }],
        expectedPrintings: { "1": "M11/149", "3": "AAA/1", "9": "X/1" },
      },
    );
    expect(out.map((m) => m.message)).toEqual([
      "line 1: expected M11/149 but got LEA/161",
      "line 3: expected AAA/1 but got none",
      "line 9: expected X/1 but got none",
    ]);
  });

  it("compares every export byte for byte", async () => {
    const out = await run(
      {
        "deck.txt": deck,
        "expected.mtgo.txt": "4 Lightning Bolt\n56 Mountain\n",
        "expected.dec": "x",
        "expected.mtga.txt": "y",
      },
      { format: "official:modern", expectedViolations: [] },
    );
    expect(out.map((m) => m.check)).toEqual([
      "export-mtgo",
      "export-dec",
      "export-mtga",
    ]);
    expect(out[0]?.message).toContain(
      '"4 Lightning Bolt\\r\\n56 Mountain\\r\\n"',
    );
  });

  it("compares the MTGA warnings", async () => {
    const files = {
      "deck.txt": "1 Lightning Bolt (M11) 149\n",
      "expected.mtga.txt": "1 Lightning Bolt (M11) 149",
    };
    const ok = await run(files, {
      format: "official:modern",
      expectedViolations: [{ code: "E-DECK-MAIN-SIZE" }],
      expectedMtgaWarnings: [{ code: "W-MTGA-UNAVAILABLE", line: 1 }],
    });
    expect(ok).toEqual([]);
    const bad = await run(files, {
      format: "official:modern",
      expectedViolations: [{ code: "E-DECK-MAIN-SIZE" }],
    });
    expect(bad.map((m) => m.check)).toEqual(["mtga-warnings"]);
  });

  it("runs a preset case", async () => {
    const out = await run(
      { "deck.txt": "4 Treasure Cruise\n56 Mountain\n" },
      {
        format: "preset:2015-modern@1",
        expectedViolations: [{ code: "E-LEGAL-BANNED", line: 1 }],
      },
    );
    expect(out).toEqual([]);
  });

  it("reports a bad format reference, a repo format and a missing preset", async () => {
    const spec = (format: string) => ({ format, expectedViolations: [] });
    expect(
      (await run({ "deck.txt": deck }, spec("commander")))[0],
    ).toMatchObject({ check: "format" });
    expect(
      (await run({ "deck.txt": deck }, spec("repo:formats/a.yaml")))[0]
        ?.message,
    ).toContain("repo:");
    const missing = await run({ "deck.txt": deck }, spec("preset:nope@1"));
    expect(missing[0]).toMatchObject({ check: "run" });
  });

  it("reports a preset that is invalid", async () => {
    const dir = join(tmp, "presets");
    mkdirSync(dir);
    writeFileSync(join(dir, "bad@1.yaml"), "id: bad\n");
    writeFileSync(
      join(dir, "other@1.yaml"),
      "schema_version: 1\nid: other2\nname: O\nlegality_by: name\nsets: [M10]\nbanned: [Not A Card]\n",
    );
    const casesDir = makeCase(
      { "deck.txt": deck },
      { format: "preset:bad@1", expectedViolations: [] },
    );
    const out = await runConformance(lookup, { casesDir, presetsDir: dir });
    expect(out[0]?.message).toContain("is invalid");
    const casesDir2 = makeCase(
      { "deck.txt": deck },
      { format: "preset:other@1", expectedViolations: [] },
    );
    const out2 = await runConformance(lookup, {
      casesDir: casesDir2,
      presetsDir: dir,
    });
    expect(out2[0]?.message).toMatch(/E-FORMAT-INVALID.*id|E-FORMAT-INVALID/);
  });

  it("reports a case with no case.json", async () => {
    const out = await run({ "deck.txt": deck });
    expect(out[0]).toMatchObject({ case: "case", check: "run" });
  });
});
