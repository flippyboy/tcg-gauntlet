import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkFormatDef,
  formatKey,
  officialRules,
  parseFormatDef,
  parseFormatRef,
} from "@tcg-gauntlet/engine";
import type {
  CardLookup,
  DeckRules,
  FormatDef,
  FormatKey,
  FormatRef,
  GauntletDef,
  Violation,
} from "@tcg-gauntlet/engine";
import { violation } from "@tcg-gauntlet/engine";
import type { RepoContents } from "./types.js";

export interface ResolveOptions {
  /** Where `<id>@<n>.yaml` presets are read from. Default: `PRESETS_DIR`. */
  presetsDir?: string;
  /**
   * Finds cards, to check that the names in a custom definition are cards
   * (E-FORMAT-INVALID). Without it that check is skipped.
   */
  lookup?: Pick<CardLookup, "findCard">;
  /** The `gauntlet.yaml` path that violations point at. Default `gauntlet.yaml`. */
  file?: string;
}

export interface ResolvedFormat {
  ref: FormatRef;
  key: FormatKey;
  /** The definition of a custom format, null for an official one. */
  def: FormatDef | null;
  rules: DeckRules;
}

export type FormatResolution = ResolvedFormat | { violations: Violation[] };

/** True when `resolveFormat` failed. */
export function isFormatFailure(
  r: FormatResolution,
): r is { violations: Violation[] } {
  return "violations" in r;
}

/**
 * Turns the `format` value of a gauntlet into a definition, a key and deck rules
 * (spec/format-definition.md, "Format references and format keys").
 */
export async function resolveFormat(
  gauntlet: Pick<GauntletDef, "format">,
  contents: Pick<RepoContents, "formats">,
  opts: ResolveOptions = {},
): Promise<FormatResolution> {
  const file = opts.file ?? "gauntlet.yaml";
  const ref = parseFormatRef(gauntlet.format);
  if (ref === null) {
    return {
      violations: [
        violation(
          "E-FORMAT-UNKNOWN",
          file,
          `The format "${gauntlet.format}" is not a preset, a formats/ file or an official format`,
        ),
      ],
    };
  }
  if (ref.kind === "official") {
    return {
      ref,
      key: await formatKey(ref.ref, null),
      def: null,
      rules: officialRules(ref.name).deck,
    };
  }

  let text: string;
  let defFile: string;
  if (ref.kind === "repo") {
    defFile = ref.path;
    const found = contents.formats.find((f) => f.path === ref.path);
    if (found === undefined) {
      return {
        violations: [
          violation(
            "E-FORMAT-UNKNOWN",
            file,
            `The file ${ref.path} is not in the deck repo`,
          ),
        ],
      };
    }
    text = found.text;
  } else {
    const dir = opts.presetsDir ?? process.env["PRESETS_DIR"];
    if (dir === undefined || dir === "") {
      throw new Error(
        "No presets directory: pass presetsDir or set PRESETS_DIR",
      );
    }
    defFile = `presets/${ref.id}@${ref.revision}.yaml`;
    try {
      text = await readFile(
        join(dir, `${ref.id}@${ref.revision}.yaml`),
        "utf8",
      );
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
      return {
        violations: [
          violation(
            "E-FORMAT-UNKNOWN",
            file,
            `This tool has no preset ${ref.ref}`,
          ),
        ],
      };
    }
  }

  const parsed = parseFormatDef(text, defFile);
  if (parsed.def === null) return { violations: parsed.violations };
  if (opts.lookup !== undefined) {
    const problems = checkFormatDef(parsed.def, {
      file: defFile,
      lookup: opts.lookup,
      ...(ref.kind === "preset" ? { expectedId: ref.id } : {}),
    });
    if (problems.length > 0) return { violations: problems };
  } else if (ref.kind === "preset" && parsed.def.id !== ref.id) {
    return {
      violations: [
        violation(
          "E-FORMAT-INVALID",
          defFile,
          `The id "${parsed.def.id}" does not match the reference "${ref.ref}"`,
        ),
      ],
    };
  }
  return {
    ref,
    key: await formatKey(ref.ref, parsed.def),
    def: parsed.def,
    rules: parsed.def.deck,
  };
}
