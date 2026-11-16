// Spike 2: build the MTGJSON pool for preset 2015-modern@1 and diff it against site-pool.txt (Scryfall reference).
// Run: node spikes/modern-2015-pool/compare.ts [--no-tsb] [--english-only]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SETS, BANNED, MTGJSON } from '../mtgjson-size/preset.ts';

const noTsb = process.argv.includes('--no-tsb');
const sets = SETS.filter((s) => !(noTsb && s === 'TSB'));
const db = new DatabaseSync(MTGJSON, { readOnly: true });
const ph = sets.map(() => '?').join(',');

const rule = `c.setCode in (${ph}) and coalesce(c.isFunny,0)=0 and coalesce(c.isOnlineOnly,0)=0 and coalesce(c.isOversized,0)=0`
  + (process.argv.includes('--english-only') ? ` and c.language='English'` : '');
const poolNamesBeforeBan = new Set((db.prepare(`select distinct c.name from cards c where ${rule}`).all(...sets) as { name: string }[]).map((r) => r.name));

// Banlist checks against MTGJSON
const exists = db.prepare('select count(*) c from cards where name=?');
const missing = BANNED.filter((b) => (exists.get(b) as any).c === 0);
const notInPool = BANNED.filter((b) => !poolNamesBeforeBan.has(b));
console.log('banned count', BANNED.length, 'unique', new Set(BANNED).size, '| missing from MTGJSON:', missing, '| not in pool (before ban):', notInPool);
console.log('Golgari Grave-Troll in pool:', poolNamesBeforeBan.has('Golgari Grave-Troll'));

const mtg = new Set([...poolNamesBeforeBan].filter((n) => !BANNED.includes(n)));
const site = new Set(readFileSync(new URL('./site-pool.txt', import.meta.url), 'utf8').split('\n').filter(Boolean));
console.log(`sets=${sets.length}${noTsb ? ' (TSB removed)' : ''} mtgjson pool=${mtg.size} site pool=${site.size}`);
const onlyMtg = [...mtg].filter((n) => !site.has(n)).sort();
const onlySite = [...site].filter((n) => !mtg.has(n)).sort();

const info = db.prepare(`select setCode, number, language, isPromo, isTimeshifted, availability from cards c where c.name=? and ${rule} order by setCode limit 6`);
const infoAll = db.prepare(`select setCode, number, language, isFunny, isOnlineOnly, isOversized, isPromo from cards where name=? or faceName=? order by setCode`);
console.log(`\nONLY IN MTGJSON POOL (${onlyMtg.length})`);
for (const n of onlyMtg) console.log(' ', n, JSON.stringify(info.all(n, ...sets).map((r: any) => `${r.setCode}#${r.number}${r.language !== 'English' ? ' ' + r.language : ''}`)));
console.log(`\nONLY IN SITE POOL (${onlySite.length})`);
for (const n of onlySite) console.log(' ', n, JSON.stringify((infoAll.all(n, n) as any[]).slice(0, 8).map((r) => `${r.setCode}#${r.number}${r.language !== 'English' ? ' ' + r.language : ''}${r.isFunny ? ' funny' : ''}${r.isOnlineOnly ? ' online' : ''}${r.isOversized ? ' oversize' : ''}`)));
