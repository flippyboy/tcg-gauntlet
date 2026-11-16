import { normalizeName } from "./normalize-name.js";
import { resolveDeck } from "./resolve.js";
import type {
  CardLookup,
  CardRef,
  DeckRules,
  FormatDef,
  FormatKey,
  OfficialRules,
  ParsedDeck,
  ResolvedDeck,
  ResolvedEntry,
  Violation,
} from "./types.js";
import { sortViolations, violation } from "./util.js";

/** Layouts whose faces are halves of one card, not faces to write by front name. */
const SPLIT_LAYOUTS = new Set(["split", "aftermath"]);

/** True when `name` identifies `card` (full name, or front face of a two-face card). */
export function cardMatchesName(card: CardRef, name: string): boolean {
  const n = normalizeName(name);
  if (n === normalizeName(card.name)) return true;
  const front = card.faces[0];
  return (
    front !== undefined &&
    card.faces.length > 1 &&
    !SPLIT_LAYOUTS.has(card.layout) &&
    n === normalizeName(front.name)
  );
}

function isExempt(card: CardRef, deck: DeckRules): boolean {
  return (
    (card.copyExempt === "basic" && deck.copy_exempt.includes("basic_lands")) ||
    (card.copyExempt === "any_number" &&
      deck.copy_exempt.includes("any_number_text"))
  );
}

/**
 * Checks a resolved deck against format rules (spec/format-definition.md, "Deck
 * rules" and "The card pool"). Returns the legality, size, copy and section
 * violations, ordered as the spec says. Parse and resolve violations are not
 * included. `checkDeck` collects all of them.
 */
export function validateDeck(
  resolved: ResolvedDeck,
  rules: FormatDef | OfficialRules,
  formatKey: FormatKey,
  lookup: CardLookup,
): Violation[] {
  const file = resolved.parsed.path;
  const out: Violation[] = [];
  const deck = rules.deck;
  const counted = resolved.entries.filter((e) => e.section !== "commander");

  // Commander sections.
  for (const line of resolved.parsed.commanderHeaderLines) {
    out.push(
      violation(
        "E-DECK-SECTION",
        file,
        "A Commander section is not allowed in any v1 format",
        line,
      ),
    );
  }

  // Per-line legality.
  const firstLine = new Map<string, number>();
  const totals = new Map<
    string,
    { card: CardRef; count: number; legal: boolean }
  >();
  for (const e of counted) {
    if (e.card === null) continue;
    const card = e.card;
    const verdict = judge(card, rules, formatKey, lookup);
    if (verdict.violation !== null) {
      out.push(
        violation(verdict.violation, file, verdict.message, e.line.line),
      );
    }
    const t = totals.get(card.name) ?? {
      card,
      count: 0,
      legal: verdict.violation === null,
    };
    t.count += e.count;
    totals.set(card.name, t);
    if (!firstLine.has(card.name)) firstLine.set(card.name, e.line.line);
  }

  // Counts per card, over main deck and sideboard together.
  for (const [name, t] of totals) {
    const line = firstLine.get(name);
    if (t.legal && t.count > 1 && isRestricted(t.card, rules, lookup)) {
      out.push(
        violation(
          "E-LEGAL-RESTRICTED",
          file,
          `"${name}" is restricted: at most 1 copy, but the deck has ${t.count}`,
          line,
        ),
      );
    }
    if (!isExempt(t.card, deck) && t.count > deck.max_copies) {
      out.push(
        violation(
          "E-DECK-COPIES",
          file,
          `"${name}" has ${t.count} copies, but at most ${deck.max_copies} are allowed`,
          line,
        ),
      );
    }
  }

  // Sizes.
  const size = (s: ResolvedEntry["section"]): number =>
    counted.filter((e) => e.section === s).reduce((n, e) => n + e.count, 0);
  const main = size("main");
  const side = size("sideboard");
  if (main < deck.min_main) {
    out.push(
      violation(
        "E-DECK-MAIN-SIZE",
        file,
        `The main deck has ${main} cards, but needs at least ${deck.min_main}`,
      ),
    );
  } else if (deck.max_main !== undefined && main > deck.max_main) {
    out.push(
      violation(
        "E-DECK-MAIN-SIZE",
        file,
        `The main deck has ${main} cards, but at most ${deck.max_main} are allowed`,
      ),
    );
  }
  if (side > deck.max_sideboard) {
    out.push(
      violation(
        "E-DECK-SIDEBOARD-SIZE",
        file,
        `The sideboard has ${side} cards, but at most ${deck.max_sideboard} are allowed`,
      ),
    );
  }
  return sortViolations(out);
}

interface Verdict {
  violation: "E-LEGAL-BANNED" | "E-LEGAL-NOT-IN-POOL" | null;
  message: string;
}

const ok: Verdict = { violation: null, message: "" };

function judge(
  card: CardRef,
  rules: FormatDef | OfficialRules,
  formatKey: FormatKey,
  lookup: CardLookup,
): Verdict {
  if ("official" in rules) {
    const l = lookup.officialLegality(rules.official, card);
    if (l === "banned") {
      return {
        violation: "E-LEGAL-BANNED",
        message: `"${card.name}" is banned in ${rules.name}`,
      };
    }
    if (l === "not_legal") {
      return {
        violation: "E-LEGAL-NOT-IN-POOL",
        message: `"${card.name}" is not legal in ${rules.name}`,
      };
    }
    return ok;
  }
  if (rules.banned.some((n) => cardMatchesName(card, n))) {
    return {
      violation: "E-LEGAL-BANNED",
      message: `"${card.name}" is banned in ${rules.name}`,
    };
  }
  const excluded = rules.exclude.some((o) => cardMatchesName(card, o.name));
  if (excluded || !lookup.inPool(formatKey, card)) {
    return {
      violation: "E-LEGAL-NOT-IN-POOL",
      message: `"${card.name}" is not in the pool of ${rules.name}`,
    };
  }
  return ok;
}

function isRestricted(
  card: CardRef,
  rules: FormatDef | OfficialRules,
  lookup: CardLookup,
): boolean {
  if ("official" in rules)
    return lookup.officialLegality(rules.official, card) === "restricted";
  return rules.restricted.some((n) => cardMatchesName(card, n));
}

/**
 * Resolves and validates a parsed deck, and returns every violation (parse errors,
 * warnings, resolution and validation) in the spec's order.
 */
export function checkDeck(
  parsed: ParsedDeck,
  rules: FormatDef | OfficialRules,
  formatKey: FormatKey,
  lookup: CardLookup,
): { resolved: ResolvedDeck; violations: Violation[] } {
  const resolved = resolveDeck(parsed, formatKey, lookup);
  const violations = sortViolations([
    ...parsed.parseErrors,
    ...parsed.warnings,
    ...resolved.violations,
    ...validateDeck(resolved, rules, formatKey, lookup),
  ]);
  return { resolved, violations };
}
