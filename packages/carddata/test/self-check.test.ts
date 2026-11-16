import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { fileUri, selfCheck } from "../src/index.js";
import { copyFixture } from "./helpers.js";

function attached(path: string): Database.Database {
  const db = new Database(":memory:");
  db.prepare("ATTACH DATABASE ? AS mtg").run(fileUri(path, "?mode=ro"));
  return db;
}

describe("selfCheck", () => {
  it("passes with minCards: 100", () => {
    const db = attached(copyFixture());
    expect(selfCheck(db, { minCards: 100 })).toEqual([]);
    db.close();
  });

  it("fails when there are fewer cards than the default minimum", () => {
    const db = attached(copyFixture());
    const problems = selfCheck(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/only 116 distinct card names, expected 20000/);
    db.close();
  });

  it("fails on a missing column", () => {
    const path = copyFixture();
    const w = new Database(path);
    w.exec("ALTER TABLE cards DROP COLUMN faceName");
    w.close();
    const db = attached(path);
    expect(selfCheck(db, { minCards: 100 })).toEqual([
      "column cards.faceName is missing",
    ]);
    db.close();
  });

  it("fails on a missing table", () => {
    const path = copyFixture();
    const w = new Database(path);
    w.exec("DROP TABLE cardLegalities");
    w.close();
    const db = attached(path);
    expect(selfCheck(db, { minCards: 100 })).toEqual([
      "table cardLegalities is missing",
    ]);
    db.close();
  });
});
