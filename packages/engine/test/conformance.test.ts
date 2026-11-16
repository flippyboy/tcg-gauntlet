import { describe, expect, it } from "vitest";
import { fakeLookup, runConformance } from "../../conformance/src/index.js";
import { fixturesDir, repoRoot } from "./helpers.js";

describe("conformance corpus", () => {
  it("passes against the in-memory lookup", async () => {
    const mismatches = await runConformance(
      fakeLookup(`${fixturesDir}cards.json`),
      {
        casesDir: `${repoRoot}conformance/cases`,
        presetsDir: `${repoRoot}presets`,
      },
    );
    expect(mismatches).toEqual([]);
  });
});
