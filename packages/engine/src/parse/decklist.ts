import type { ParsedDeck, ParsedLine, Section, Violation } from "../types.js";
import { codePointLength, violation } from "../util.js";
import {
  parseFrontMatter,
  splitFrontMatter,
  unterminatedFrontMatter,
} from "./front-matter.js";

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_CARD_LINES = 250;
export const MAX_LINE_CHARS = 300;

const SECTION_HEADERS: Record<string, Section> = {
  deck: "main",
  main: "main",
  mainboard: "main",
  sideboard: "sideboard",
  companion: "sideboard",
  commander: "commander",
};

const COUNT = /^([1-9][0-9]{0,2})[xX]?[ \t]+/;
const HINT = /^\[([A-Za-z0-9]{0,6})\][ \t]+/;
const SET_TAIL = /^([A-Za-z0-9]{2,6})\)(.*)$/s;
const NUMBER_TAIL = /^[ \t]+([A-Za-z0-9★\-/]+)$/;
const SB_PREFIX = /^SB:[ \t]+(.*)$/is;

interface CardLine {
  count: number;
  rawName: string;
  hint?: string;
  set?: string;
  number?: string;
}

/**
 * Parses the part of a list line after any `SB:` prefix. Linear time: every
 * pattern is anchored and has no nested quantifiers. Returns a reason on failure.
 */
export function parseCardLine(text: string): CardLine | string {
  const c = COUNT.exec(text);
  if (!c) return "Expected a count, such as 4 or 4x, followed by a card name";
  const count = Number(c[1]);
  let rest = text.slice(c[0].length);
  let hint: string | undefined;
  let hasHint = false;
  const h = HINT.exec(rest);
  if (h) {
    hasHint = true;
    if ((h[1] ?? "") !== "") hint = h[1];
    rest = rest.slice(h[0].length);
  }
  rest = trimEnd(rest);

  // The last whitespace character that is followed by "(".
  let open = -1;
  for (let i = rest.length - 2; i >= 0; i--) {
    if (rest[i + 1] === "(" && (rest[i] === " " || rest[i] === "\t")) {
      open = i + 1;
      break;
    }
  }
  let rawName = rest;
  let set: string | undefined;
  let number: string | undefined;
  if (open >= 0) {
    const s = SET_TAIL.exec(rest.slice(open + 1));
    if (s) {
      const tail = s[2] ?? "";
      if (tail !== "") {
        const n = NUMBER_TAIL.exec(tail);
        if (!n)
          return "Expected nothing, or a collector number, after the set code";
        number = n[1];
      }
      set = s[1];
      rawName = trimEnd(rest.slice(0, open));
    }
  }
  if (rawName === "") return "The card name is empty";
  if (hasHint && set !== undefined) {
    return "A line cannot have both a [SET] hint and a (SET) code";
  }
  const out: CardLine = { count, rawName };
  if (hint !== undefined) out.hint = hint;
  if (set !== undefined) out.set = set;
  if (number !== undefined) out.number = number;
  return out;
}

function toLines(input: string | Uint8Array): (string | null)[] {
  if (typeof input === "string") {
    const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
    return text.split("\n").map(stripCr);
  }
  let bytes = input;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const out: (string | null)[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      try {
        out.push(stripCr(decoder.decode(bytes.subarray(start, i))));
      } catch {
        out.push(null);
      }
      start = i + 1;
    }
  }
  return out;
}

/** Whitespace trimming by index, so the cost is linear whatever the input. */
function trimStart(s: string): string {
  let i = 0;
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return s.slice(i);
}

function trimEnd(s: string): string {
  let j = s.length;
  while (j > 0 && (s[j - 1] === " " || s[j - 1] === "\t")) j--;
  return s.slice(0, j);
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function byteLength(input: string | Uint8Array): number {
  return typeof input === "string"
    ? new TextEncoder().encode(input).length
    : input.length;
}

/**
 * Parses a deck file: optional front matter, then the list (spec/deck-file.md).
 * `input` may be bytes, in which case lines that are not valid UTF-8 give
 * E-PARSE-LINE and are skipped.
 */
export function parseDeck(
  input: string | Uint8Array,
  path: string,
): ParsedDeck {
  const deck: ParsedDeck = {
    path,
    frontMatter: {},
    lines: [],
    commanderHeaderLines: [],
    warnings: [],
    parseErrors: [],
    schemaVersion: 1,
  };
  const err = (
    code: Violation["code"],
    message: string,
    line?: number,
  ): void => {
    deck.parseErrors.push(violation(code, path, message, line));
  };

  if (byteLength(input) > MAX_FILE_BYTES) {
    err(
      "E-LIMIT-EXCEEDED",
      `The file is larger than ${MAX_FILE_BYTES / 1024} KB`,
    );
    return deck;
  }

  const all = toLines(input);
  const fm = splitFrontMatter(all);
  if (fm.unterminated) {
    deck.parseErrors.push(unterminatedFrontMatter(path));
    return deck;
  }
  if (fm.present) {
    const r = parseFrontMatter(fm.yaml, path);
    deck.frontMatter = r.frontMatter;
    deck.schemaVersion = r.schemaVersion;
    deck.parseErrors.push(...r.errors);
    deck.warnings.push(...r.warnings);
  }

  let section: Section = "main";
  let headerSeen = false;
  let plainCardSeen = false;
  let blankSideboard = false;
  let cardLines = 0;

  for (let i = fm.listStart; i < all.length; i++) {
    const lineNo = i + 1;
    const raw = all[i];
    if (raw === null || raw === undefined) {
      err("E-PARSE-LINE", "The line is not valid UTF-8", lineNo);
      continue;
    }
    const text = trimEnd(trimStart(raw));

    // 1. Blank.
    if (text === "") {
      if (!headerSeen && !blankSideboard && plainCardSeen) {
        blankSideboard = true;
        section = "sideboard";
      }
      continue;
    }
    // 2. Comment.
    if (text.startsWith("//") || text.startsWith("#")) continue;
    // 3. Section header.
    const headerKey = (
      text.endsWith(":") ? text.slice(0, -1) : text
    ).toLowerCase();
    const headerSection = SECTION_HEADERS[headerKey];
    if (
      headerSection !== undefined &&
      Object.hasOwn(SECTION_HEADERS, headerKey)
    ) {
      headerSeen = true;
      section = headerSection;
      if (headerSection === "commander") deck.commanderHeaderLines.push(lineNo);
      continue;
    }
    // 4 and 5. SB: line, or card line.
    const sb = SB_PREFIX.exec(text);
    const body = sb ? (sb[1] ?? "") : text;
    if (codePointLength(text) > MAX_LINE_CHARS) {
      err(
        "E-LIMIT-EXCEEDED",
        `The line is longer than ${MAX_LINE_CHARS} characters`,
        lineNo,
      );
      continue;
    }
    if (cardLines >= MAX_CARD_LINES) {
      err(
        "E-LIMIT-EXCEEDED",
        `The deck has more than ${MAX_CARD_LINES} card lines`,
        lineNo,
      );
      break;
    }
    const parsed = parseCardLine(body);
    if (typeof parsed === "string") {
      err("E-PARSE-LINE", parsed, lineNo);
      continue;
    }
    cardLines++;
    if (!sb) plainCardSeen = true;
    const pl: ParsedLine = {
      line: lineNo,
      count: parsed.count,
      rawName: parsed.rawName,
      section: sb ? "sideboard" : section,
    };
    if (parsed.hint !== undefined) pl.hint = parsed.hint;
    if (parsed.set !== undefined) pl.set = parsed.set;
    if (parsed.number !== undefined) pl.number = parsed.number;
    deck.lines.push(pl);
  }
  return deck;
}
