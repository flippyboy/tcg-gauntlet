// Spike 1: build the derived tables against the real MTGJSON file and time every stage.
// Run: node spikes/mtgjson-size/measure.ts [--keep]   (Node 26 runs .ts directly; node:sqlite built in)
import { DatabaseSync } from 'node:sqlite';
import { rmSync, statSync } from 'node:fs';
import { SETS, BANNED, MTGJSON, normalizeName } from './preset.ts';

const OUT = new URL('./out/derived.sqlite', import.meta.url).pathname;
for (const s of ['', '-wal', '-shm', '-journal']) rmSync(OUT + s, { force: true });
const db = new DatabaseSync(OUT);
const t0 = performance.now();
let last = t0;
const lap = (label: string) => {
  const n = performance.now();
  const rss = process.resourceUsage().maxRSS / 1024;
  console.log(`${label.padEnd(44)} ${((n - last) / 1000).toFixed(3).padStart(8)} s   (maxRSS so far ${rss.toFixed(0)} MiB)`);
  last = n;
};
const count = (t: string, w = '') => (db.prepare(`select count(*) c from ${t} ${w}`).get() as { c: number }).c;

db.exec(`pragma journal_mode=wal; pragma synchronous=off; pragma temp_store=file;`);
db.exec(`attach 'file:${MTGJSON}?mode=ro' as mtg`);
lap('open + ATTACH mode=ro');

// self-check
const need: Record<string, string[]> = {
  cards: ['name', 'faceName', 'side', 'layout', 'setCode', 'number', 'uuid', 'availability', 'isFunny', 'isOnlineOnly', 'isOversized', 'isPromo', 'originalReleaseDate', 'supertypes', 'types', 'text', 'manaValue', 'language', 'hasAlternativeDeckLimit', 'asciiName'],
  sets: ['code', 'type', 'releaseDate'], cardLegalities: ['uuid', 'modern', 'vintage'], cardIdentifiers: ['uuid', 'scryfallId'], meta: ['date', 'version'],
};
for (const [t, cols] of Object.entries(need)) {
  const have = new Set((db.prepare(`select name from mtg.pragma_table_info('${t}')`).all() as { name: string }[]).map((r) => r.name));
  const miss = cols.filter((c) => !have.has(c));
  if (miss.length) throw new Error(`missing ${t}: ${miss}`);
}
console.log('cards rows:', count('mtg.cards'));
lap('self-check (pragma_table_info + count)');

db.exec(`
create table formats(format_key text primary key, built_at text);
create table format_pool(format_key text not null, name text not null, primary key(format_key, name)) without rowid;
create table default_printing(format_key text not null, name text not null, uuid text not null, primary key(format_key, name)) without rowid;
create table card_names(norm_name text not null, name text not null, face_name text);
create table card_meta(name text primary key, supertypes text, layout text, copy_exempt integer not null) without rowid;
create temp table fmt_sets(code text primary key);
create temp table fmt_banned(name text primary key);
`);
const ins = db.prepare('insert into fmt_sets values (?)'); for (const s of SETS) ins.run(s);
const insb = db.prepare('insert into fmt_banned values (?)'); for (const b of BANNED) insb.run(b);

const KEY = 'preset:2015-modern@1#000000000000';
const POOL_PRINTING = `coalesce(c.isFunny,0)=0 and coalesce(c.isOnlineOnly,0)=0 and coalesce(c.isOversized,0)=0`;

db.exec('begin');
// (a) format_pool
db.exec(`insert into format_pool select distinct '${KEY}', c.name from mtg.cards c
  where c.setCode in (select code from fmt_sets) and ${POOL_PRINTING}
  and c.name not in (select name from fmt_banned)`);
lap(`(a) format_pool 2015 Modern -> ${count('format_pool')} names`);

// (b) default_printing. Window ordering per design "Default printing".
// Face rows: only side IS NULL or 'a' so the uuid is the front-face row.
const RANK = (partition: string) => `row_number() over (partition by ${partition} order by
  coalesce(c.isPromo,0), coalesce(nullif(c.originalReleaseDate,''), s.releaseDate),
  case when s.type in ('core','expansion') then 0 else 1 end,
  cast(c.number as integer), c.number, c.uuid)`;
db.exec(`insert into default_printing
  select '${KEY}', name, uuid from (
    select c.name, c.uuid, ${RANK('c.name')} rn
    from mtg.cards c join mtg.sets s on s.code=c.setCode
    where c.setCode in (select code from fmt_sets) and ${POOL_PRINTING}
      and c.availability like '%paper%' and (c.side is null or c.side='a')
      and c.name in (select name from format_pool where format_key='${KEY}')
  ) where rn=1`);
lap(`(b1) default_printing 2015 Modern -> ${count('default_printing', `where format_key='${KEY}'`)}`);
db.exec(`insert into default_printing
  select 'official:modern#mtgjson', name, uuid from (
    select c.name, c.uuid, ${RANK('c.name')} rn
    from mtg.cards c join mtg.sets s on s.code=c.setCode
    where ${POOL_PRINTING} and c.availability like '%paper%' and (c.side is null or c.side='a')
  ) where rn=1`);
lap(`(b2) default_printing official:modern -> ${count('default_printing', `where format_key='official:modern#mtgjson'`)}`);
db.exec('commit');

// (c) card_names + FTS5 trigram. Normalisation in JS (NFKD), as the design says.
db.exec('begin');
const rows = db.prepare(`select name, faceName, asciiName from mtg.cards group by name, faceName`).all() as { name: string; faceName: string | null; asciiName: string | null }[];
const seen = new Set<string>();
const insn = db.prepare('insert into card_names values (?,?,?)');
const add = (norm: string, name: string, face: string | null) => { const k = norm + '\0' + name; if (seen.has(k)) return; seen.add(k); insn.run(norm, name, face); };
for (const r of rows) {
  add(normalizeName(r.name), r.name, r.faceName);
  if (r.name.includes(' // ')) add(normalizeName(r.name.replace(' // ', '/')), r.name, r.faceName);
  if (r.faceName) add(normalizeName(r.faceName), r.name, r.faceName);
  if (r.asciiName) add(normalizeName(r.asciiName), r.name, r.faceName);
}
db.exec('create index card_names_norm on card_names(norm_name)');
lap(`(c1) card_names (JS normalise) -> ${count('card_names')} rows`);
db.exec(`create virtual table card_names_fts using fts5(norm_name, tokenize='trigram'); insert into card_names_fts(rowid, norm_name) select rowid, norm_name from card_names;`);
db.exec('commit');
lap('(c2) card_names_fts (fts5 trigram)');
const sug = db.prepare(`select distinct n.name from card_names_fts f join card_names n on n.rowid=f.rowid where card_names_fts match ? limit 5`).all('"lighnting"'.replace(/"/g, ''));
const t1 = performance.now();
const sug2 = db.prepare(`select distinct n.name from card_names_fts f join card_names n on n.rowid=f.rowid where card_names_fts match ? limit 5`).all('"ightnin"');
console.log('  suggest "ightnin" ->', sug2.map((r: any) => r.name).join('; '), `(${(performance.now() - t1).toFixed(1)} ms)`);
last = performance.now();

// (d) card_meta
db.exec('begin');
db.exec(`insert into card_meta
  select name, (select c2.supertypes from mtg.cards c2 where c2.name=c.name order by (c2.side is null or c2.side='a') desc limit 1),
         min(layout),
         max(case when supertypes like '%Basic%' or coalesce(hasAlternativeDeckLimit,0)=1 or text like '%A deck can have any number of cards named%' then 1 else 0 end)
  from mtg.cards c group by name`);
db.exec('commit');
lap(`(d) card_meta -> ${count('card_meta')} rows, copy_exempt=${count('card_meta', 'where copy_exempt=1')}`);

db.prepare(`insert into formats values (?, datetime('now'))`).run(KEY);
db.exec('pragma wal_checkpoint(truncate); analyze main');
lap('analyze + checkpoint');
console.log(`TOTAL build ${((performance.now() - t0) / 1000).toFixed(2)} s; peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MiB`);
db.close();
console.log('derived.sqlite bytes:', statSync(OUT).size);
