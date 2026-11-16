import type {
  DeckRules,
  OfficialFormatName,
  OfficialLegality,
  OfficialRules,
} from "./types.js";

export const OFFICIAL_FORMAT_NAMES: readonly OfficialFormatName[] = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
];

const DISPLAY: Record<OfficialFormatName, string> = {
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
};

export function isOfficialFormatName(s: string): s is OfficialFormatName {
  return (OFFICIAL_FORMAT_NAMES as readonly string[]).includes(s);
}

/** The MTGJSON `cardLegalities` column of an official format. */
export function legalityColumn(name: OfficialFormatName): string {
  return name;
}

function deckRules(): DeckRules {
  return {
    min_main: 60,
    max_sideboard: 15,
    max_copies: 4,
    copy_exempt: ["basic_lands", "any_number_text"],
  };
}

/**
 * The deck rules of an official format (spec/format-definition.md, "Official
 * formats"). Vintage differs only in that MTGJSON marks some cards `Restricted`,
 * which the legality mapping and the validator handle.
 */
export function officialRules(name: OfficialFormatName): OfficialRules {
  return { official: name, name: DISPLAY[name], deck: deckRules() };
}

/** Maps an MTGJSON `cardLegalities` value to a legality. */
export function mapMtgjsonLegality(
  value: string | null | undefined,
): OfficialLegality {
  switch (value) {
    case "Legal":
      return "legal";
    case "Restricted":
      return "restricted";
    case "Banned":
      return "banned";
    default:
      return "not_legal";
  }
}
