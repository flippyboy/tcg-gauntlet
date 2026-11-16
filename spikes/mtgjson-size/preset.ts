// Data copied from design item 22 (presets/2015-modern@1.yaml). Shared by both spikes.
export const SETS = `8ED, MRD, DST, 5DN, CHK, BOK, SOK, 9ED, RAV, GPT, DIS, CSP, TSP, TSB, PLC, FUT, 10E, LRW, MOR, SHM, EVE, ALA, CON, ARB, M10, ZEN, WWK, ROE, M11, SOM, MBS, NPH, M12, ISD, DKA, AVR, M13, RTR, GTC, DGM, M14, THS, BNG, JOU, M15, KTK, FRF, DTK, ORI`.split(', ');
export const BANNED = [
  'Ancestral Vision', 'Ancient Den', 'Birthing Pod', 'Blazing Shoal', 'Bloodbraid Elf', 'Chrome Mox', 'Cloudpost', 'Dark Depths', 'Deathrite Shaman', 'Dig Through Time', 'Dread Return', 'Glimpse of Nature', 'Great Furnace', "Green Sun's Zenith", 'Hypergenesis', 'Jace, the Mind Sculptor', 'Mental Misstep', 'Ponder', 'Preordain', 'Punishing Fire', 'Rite of Flame', 'Seat of the Synod', 'Second Sunrise', 'Seething Song', "Sensei's Divining Top", 'Skullclamp', 'Stoneforge Mystic', 'Sword of the Meek', 'Treasure Cruise', 'Tree of Tales', "Umezawa's Jitte", 'Vault of Whispers',
];
export const MTGJSON = new URL('./out/AllPrintings.sqlite', import.meta.url).pathname;
// Simplified stand-in for engine normalizeName() (design item 31).
export function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}
