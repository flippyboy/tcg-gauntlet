// The startup and refresh self-check: does an MTGJSON file still have the tables
// and columns that mtgjson-queries.ts uses, and does it hold enough cards?
import type Database from "better-sqlite3";
import { MtgQueries, REQUIRED_SCHEMA } from "./mtgjson-queries.js";

export interface SelfCheckOptions {
  /** The fewest distinct card names a real file has. Default 20,000. */
  minCards?: number;
}

/**
 * Checks the MTGJSON file attached to `db` as `mtg`. Returns the problems found.
 * An empty list means the file is usable.
 */
export function selfCheck(
  db: Database.Database,
  { minCards = 20000 }: SelfCheckOptions = {},
): string[] {
  const problems: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    const have = new Set(
      (
        db.prepare(`PRAGMA mtg.table_info("${table}")`).all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    );
    if (have.size === 0) {
      problems.push(`table ${table} is missing`);
      continue;
    }
    for (const column of columns) {
      if (!have.has(column))
        problems.push(`column ${table}.${column} is missing`);
    }
  }
  // Counting needs the tables above, so it runs only when they are there.
  if (problems.length === 0) {
    const count = new MtgQueries(db).cardCount();
    if (count < minCards)
      problems.push(`only ${count} distinct card names, expected ${minCards}`);
  }
  return problems;
}
