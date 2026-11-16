import { describe, expect, it } from "vitest";
import { formatDate, formatUtc } from "../src/lib/format.js";

describe("format", () => {
  it("writes UTC times the same on every machine", () => {
    expect(formatUtc("2026-11-16T02:50:31.000Z")).toBe("2026-11-16 02:50 UTC");
    expect(formatUtc("2026-11-16T03:50:00+01:00")).toBe("2026-11-16 02:50 UTC");
    expect(formatDate("2026-11-16T23:59:59-05:00")).toBe("2026-11-17");
  });

  it("returns text that is not a date as it came", () => {
    expect(formatUtc("yesterday")).toBe("yesterday");
    expect(formatDate("")).toBe("");
  });
});
