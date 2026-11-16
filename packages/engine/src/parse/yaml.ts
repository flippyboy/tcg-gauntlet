import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
} from "yaml";

/** 64 KB of YAML per file (spec/gauntlet.md, Limits). */
export const MAX_YAML_BYTES = 64 * 1024;
/** Nesting depth of collections, at most. */
export const MAX_YAML_DEPTH = 10;

export type YamlResult =
  | {
      ok: true;
      /** The parsed value. `null` for an empty document. */
      value: unknown;
      /** Source line (1-based, plus the caller's offset) per JSON pointer. */
      lines: Map<string, number>;
      /** Line of the first key (or value) of the document. */
      firstLine: number;
    }
  | {
      ok: false;
      /** `limit` is E-LIMIT-EXCEEDED. `syntax` is a YAML error. */
      kind: "limit" | "syntax";
      message: string;
      line: number;
    };

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Parses YAML 1.2 with the safety limits of the spec: no aliases or anchors, no
 * repeated keys, at most 64 KB, at most 10 levels deep. `lineOffset` is added to
 * every line number (front matter starts on line 2 of its file).
 */
export function parseYamlLimited(text: string, lineOffset = 0): YamlResult {
  const first = lineOffset + 1;
  if (new TextEncoder().encode(text).length > MAX_YAML_BYTES) {
    return {
      ok: false,
      kind: "limit",
      message: `YAML is larger than ${MAX_YAML_BYTES / 1024} KB`,
      line: first,
    };
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    version: "1.2",
    uniqueKeys: true,
    lineCounter,
  });
  const lineAt = (offset: number): number =>
    lineCounter.linePos(offset).line + lineOffset;

  const err = doc.errors[0];
  if (err) {
    return {
      ok: false,
      kind: "syntax",
      message: err.message.split("\n")[0] ?? err.message,
      line:
        err.linePos?.[0]?.line !== undefined
          ? err.linePos[0].line + lineOffset
          : first,
    };
  }

  let usesAlias: number | null = null;
  visit(doc, {
    Alias(_key, node) {
      usesAlias ??= node.range ? lineAt(node.range[0]) : first;
    },
    Node(_key, node) {
      if (!isAlias(node) && "anchor" in node && node.anchor) {
        usesAlias ??= node.range ? lineAt(node.range[0]) : first;
      }
    },
  });
  if (usesAlias !== null) {
    return {
      ok: false,
      kind: "syntax",
      message: "YAML aliases and anchors are not allowed",
      line: usesAlias,
    };
  }

  const lines = new Map<string, number>();
  let tooDeep: number | null = null;
  const walk = (node: unknown, pointer: string, depth: number): void => {
    if (isMap(node)) {
      if (depth > MAX_YAML_DEPTH) tooDeep ??= nodeLine(node, first);
      for (const pair of node.items) {
        const key = isScalar(pair.key)
          ? String(pair.key.value)
          : String(pair.key);
        const p = `${pointer}/${escapePointer(key)}`;
        const range = isScalar(pair.key) ? pair.key.range : null;
        if (range) lines.set(p, lineAt(range[0]));
        walk(pair.value, p, depth + 1);
      }
    } else if (isSeq(node)) {
      if (depth > MAX_YAML_DEPTH) tooDeep ??= nodeLine(node, first);
      node.items.forEach((item, i) => {
        const p = `${pointer}/${i}`;
        const range =
          item && typeof item === "object" && "range" in item
            ? (item.range as [number, number, number] | null | undefined)
            : null;
        if (range) lines.set(p, lineAt(range[0]));
        walk(item, p, depth + 1);
      });
    }
  };
  const nodeLine = (
    node: { range?: [number, number, number] | null },
    d: number,
  ): number => (node.range ? lineAt(node.range[0]) : d);
  walk(doc.contents, "", 1);
  if (tooDeep !== null) {
    return {
      ok: false,
      kind: "limit",
      message: `YAML is nested deeper than ${MAX_YAML_DEPTH} levels`,
      line: tooDeep,
    };
  }

  const value: unknown = doc.toJS();
  let firstLine = first;
  if (isMap(doc.contents)) {
    const k = doc.contents.items[0]?.key;
    if (isScalar(k) && k.range) firstLine = lineAt(k.range[0]);
  } else if (doc.contents?.range) {
    firstLine = lineAt(doc.contents.range[0]);
  }
  lines.set("", firstLine);
  return { ok: true, value: value ?? null, lines, firstLine };
}
