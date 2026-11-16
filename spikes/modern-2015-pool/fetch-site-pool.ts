// Fetch the reference pool: Scryfall query linked from 2015modern.com, unique=cards, following next_page.
// Run: node spikes/modern-2015-pool/fetch-site-pool.ts   -> writes ../mtgjson-size/out/scryfall-raw.json and site-pool.txt
import { writeFileSync } from 'node:fs';
import { BANNED } from '../mtgjson-size/preset.ts';

const Q = '(st:core or st:expansion) date>=8ed date<=ori';
let url: string | null = 'https://api.scryfall.com/cards/search?' + new URLSearchParams({ q: Q, unique: 'cards', order: 'name' });
const H = { 'User-Agent': 'tcg-gauntlet-spike/0.1', Accept: 'application/json' };
const cards: { name: string; set: string; set_type: string; layout: string; id: string }[] = [];
let pages = 0;
let total = 0;
while (url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error('HTTP', r.status, await r.text()); process.exit(1); }
  const j: any = await r.json();
  pages++; total = j.total_cards;
  for (const c of j.data) cards.push({ name: c.name, set: c.set, set_type: c.set_type, layout: c.layout, id: c.id });
  url = j.has_more ? j.next_page : null;
  await new Promise((r) => setTimeout(r, 120));
}
console.log({ query: Q, pages, total_cards: total, fetched: cards.length });
writeFileSync(new URL('../mtgjson-size/out/scryfall-raw.json', import.meta.url), JSON.stringify({ query: Q, fetchedAt: new Date().toISOString(), total, cards }));
const ban = new Set(BANNED);
const names = [...new Set(cards.map((c) => c.name))].filter((n) => !ban.has(n)).sort();
writeFileSync(new URL('./site-pool.txt', import.meta.url), names.join('\n') + '\n');
console.log('raw names', new Set(cards.map((c) => c.name)).size, 'after ban removal', names.length, 'banned present in raw:', BANNED.filter((b) => cards.some((c) => c.name === b)).length);
