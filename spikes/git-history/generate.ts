// Synthetic deck repo generator for spike 4. Deterministic: fixed seed, authors and dates.
// Usage: node generate.ts [outDir]   (default: ./out/repo)
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, 'out', 'repo'));
const MAIN_COMMITS = 3000;
const GAUNTLETS = ['2015modern', 'pauper cube', 'legacy-1999', 'Épique', 'oldschool', 'premodern', 'highlander', 'budget', 'peasant', 'tiny-leaders'];
const AUTHORS = ['Ann Archer', 'Bo Brandt', 'Cy Çelik', 'Dee Dvořák', 'Eli Eriksen'];
const BASE_TS = 1704067200; // 2024-01-01T00:00:00Z

let seed = 20260101;
function rnd(): number { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (n: number) => Math.floor(rnd() * n);
const pick = <T,>(a: T[]): T => a[ri(a.length)];

const SETS = ['LEA', 'LEB', '2ED', 'ARN', 'M10', 'M11', 'ZEN', 'ROE', 'MM3', '2XM', 'DOM', 'MH2'];
const WORDS = ['Lightning', 'Bolt', 'Goblin', 'Guide', 'Serra', 'Angel', 'Dark', 'Ritual', 'Sol', 'Ring', 'Wrath', 'God', 'Counter', 'Spell', 'Llanowar', 'Elves', 'Black', 'Lotus', 'Time', 'Walk', 'Ancestral', 'Recall', 'Swords', 'Plowshares', 'Birds', 'Paradise', 'Giant', 'Growth', 'Ménagerie', 'Æther', 'Jötun', 'Lim-Dûl'];
const CARDS: string[] = [];
for (let i = 0; i < 400; i++) CARDS.push(`${pick(WORDS)} ${pick(WORDS)} ${i}`);

type Op = { t: 'M'; path: string; content: string } | { t: 'D'; path: string } | { t: 'R'; from: string; to: string };
const files = new Map<string, string>();

function deckText(): string {
  const lines: string[] = [];
  const n = 14 + ri(8);
  for (let i = 0; i < n; i++) lines.push(`${1 + ri(4)} ${pick(CARDS)} [${pick(SETS)}]`);
  lines.push('', 'Sideboard');
  for (let i = 0; i < 6; i++) lines.push(`${1 + ri(3)} ${pick(CARDS)} [${pick(SETS)}]`);
  return lines.join('\n') + '\n';
}
function primerText(): string {
  const l = ['# Primer', ''];
  for (let i = 0; i < 12 + ri(8); i++) l.push(`Paragraph ${i}: ${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}.`);
  return l.join('\n') + '\n';
}
function editLines(text: string, mode: 'count' | 'set' | 'primer'): string {
  const lines = text.split('\n');
  const k = 1 + ri(2);
  for (let j = 0; j < k; j++) {
    const idx = ri(lines.length - 1);
    if (mode === 'primer') { lines[idx] = `Paragraph ${idx}: ${pick(WORDS)} ${pick(WORDS)} edited ${ri(1000)}.`; continue; }
    const m = /^(\d+) (.*?) \[(\w+)\]$/.exec(lines[idx]);
    if (!m) continue;
    lines[idx] = mode === 'count' ? `${1 + ri(4)} ${m[2]} [${m[3]}]` : `${m[1]} ${m[2]} [${pick(SETS)}]`;
  }
  return lines.join('\n');
}

const NAMEPOOL = ['Burn', 'Affinity', 'Elves', 'Jund Ménage', 'Tron', 'Zoo', 'Control Freak', 'Reanimator', 'Storm', 'Mono Black', 'Białystok Stompy', 'Niño Combo', 'Ünder Grave', '日本語 deck', 'Élan Vital', 'Bant Blink', 'Dredge', 'Death & Taxes', "Rock 'n Roll", 'Merfolk', 'Slivers', 'Goblins', 'Faeries', 'Ponza', 'Cascade Crusher'];
let nameCounter = 0;
function freshStem(g: string): string {
  for (;;) {
    const n = `${pick(NAMEPOOL)}${ri(3) === 0 ? '' : ' ' + (++nameCounter)}`;
    if (!files.has(`${g}/${n}.txt`) && !files.has(`${g}/${n}.md`)) return `${g}/${n}`;
  }
}
const stems = () => [...files.keys()].filter((p) => /^[^/]+\/[^/]+\.txt$/.test(p) && !p.startsWith('formats/')).map((p) => p.slice(0, -4));

function apply(ops: Op[]) {
  for (const o of ops) {
    if (o.t === 'M') files.set(o.path, o.content);
    else if (o.t === 'D') files.delete(o.path);
    else { files.set(o.to, files.get(o.from)!); files.delete(o.from); }
  }
}

const deletedStems: string[] = [];
const stats = { create: 0, count: 0, set: 0, primer: 0, renameOnly: 0, renameEdit: 0, renameThenEdit: 0, renameTwice: 0, renameTxtOnlyMd: 0, del: 0, readd: 0, other: 0, tenFile: 0 };
const pendingEdit: string[] = []; // paths to edit in the next commit (rename then edit)
const renamedOnce: string[] = [];

function next(i: number): { ops: Op[]; msg: string } {
  // initial population: 100 decks, 10 per gauntlet
  if (i < 100) {
    const g = GAUNTLETS[i % 10];
    const stem = freshStem(g);
    const ops: Op[] = [{ t: 'M', path: stem + '.txt', content: deckText() }];
    if (rnd() < 0.65) ops.push({ t: 'M', path: stem + '.md', content: primerText() });
    stats.create++;
    return { ops, msg: `Add ${stem}` };
  }
  if (i === 100) { stats.other++; return { ops: [{ t: 'M', path: 'README.md', content: '# Deck repo\n' }, { t: 'M', path: 'formats/modern2015.yaml', content: 'name: 2015 Modern\n' }, { t: 'M', path: `${GAUNTLETS[0]}/archive/old deck.txt`, content: deckText() }, { t: 'M', path: `${GAUNTLETS[0]}/archive/notes.md`, content: 'nested\n' }], msg: 'Add README, formats and nested folder' }; }
  if (pendingEdit.length && pendingEdit[0].startsWith('__rename__')) {
    const [a, b] = pendingEdit.shift()!.slice(10).split('>');
    if (files.has(a) && !files.has(b)) return { ops: [{ t: 'R', from: a, to: b }], msg: `Rename primer ${a} to ${b}` };
  }
  if (pendingEdit.length && !pendingEdit[0].startsWith('__rename__')) {
    const p = pendingEdit.shift()!;
    if (files.has(p)) { stats.renameThenEdit++; return { ops: [{ t: 'M', path: p, content: editLines(files.get(p)!, p.endsWith('.md') ? 'primer' : 'count') }], msg: `Tweak ${p}` }; }
  }
  const r = rnd();
  const ss = stems();
  const s = pick(ss);
  const has = (p: string) => files.has(p);
  if (r < 0.40) { stats.count++; return { ops: [{ t: 'M', path: s + '.txt', content: editLines(files.get(s + '.txt')!, 'count') }], msg: `Adjust counts in ${s}` }; }
  if (r < 0.54) { stats.set++; return { ops: [{ t: 'M', path: s + '.txt', content: editLines(files.get(s + '.txt')!, 'set') }], msg: `Change set codes in ${s}` }; }
  if (r < 0.70) {
    if (has(s + '.md')) { stats.primer++; return { ops: [{ t: 'M', path: s + '.md', content: editLines(files.get(s + '.md')!, 'primer') }], msg: `Edit primer ${s}` }; }
    stats.primer++; return { ops: [{ t: 'M', path: s + '.md', content: primerText() }], msg: `Add primer ${s}` };
  }
  if (r < 0.73 || (i % 97 === 0)) { // rename family
    const kind = ri(5);
    const g = s.split('/')[0];
    let dst: string;
    // sometimes rename across gauntlets, sometimes within
    dst = freshStem(ri(4) === 0 ? pick(GAUNTLETS) : g);
    const ops: Op[] = [{ t: 'R', from: s + '.txt', to: dst + '.txt' }];
    const withMd = has(s + '.md');
    if (withMd && kind !== 4) ops.push({ t: 'R', from: s + '.md', to: dst + '.md' });
    if (withMd && kind === 4) { /* md renamed in the NEXT commit */ }
    if (kind === 0) { // rename + edit in the same commit
      ops.push({ t: 'M', path: dst + '.txt', content: editLines(files.get(s + '.txt')!, 'count') }); stats.renameEdit++;
    } else if (kind === 1) { pendingEdit.push(dst + '.txt'); stats.renameOnly++; }
    else if (kind === 4 && withMd) { pendingEdit.push('__rename__' + s + '.md>' + dst + '.md'); stats.renameTxtOnlyMd++; }
    else stats.renameOnly++;
    if (renamedOnce.includes(s)) stats.renameTwice++;
    renamedOnce.push(dst);
    return { ops, msg: `Rename ${s} to ${dst}` };
  }
  if (r < 0.735 && ss.length > 80) {
    stats.del++; deletedStems.push(s);
    const ops: Op[] = [{ t: 'D', path: s + '.txt' }];
    if (has(s + '.md')) ops.push({ t: 'D', path: s + '.md' });
    return { ops, msg: `Remove ${s}` };
  }
  if (r < 0.80 && deletedStems.length && rnd() < 0.5) {
    const d = deletedStems.shift()!; stats.readd++;
    return { ops: [{ t: 'M', path: d + '.txt', content: deckText() }], msg: `Re-add ${d}` };
  }
  if (r < 0.82) { stats.other++; return { ops: [{ t: 'M', path: 'formats/modern2015.yaml', content: `name: 2015 Modern\nrev: ${i}\n` }, { t: 'M', path: 'README.md', content: `# Deck repo\nrev ${i}\n` }], msg: 'Update docs and formats' }; }
  if (r < 0.83) { stats.other++; return { ops: [{ t: 'M', path: `${GAUNTLETS[0]}/archive/old deck.txt`, content: deckText() }], msg: 'Edit nested archive deck' }; }
  if (r < 0.84) { // 10-file commit
    stats.tenFile++;
    const ops: Op[] = []; const pool = [...ss]; 
    for (let k = 0; k < 10 && pool.length; k++) { const p = pool.splice(ri(pool.length), 1)[0]; ops.push({ t: 'M', path: p + '.txt', content: editLines(files.get(p + '.txt')!, 'count') }); }
    return { ops, msg: 'Bulk update of 10 decks' };
  }
  stats.count++;
  return { ops: [{ t: 'M', path: s + '.txt', content: editLines(files.get(s + '.txt')!, 'count') }], msg: `Adjust counts in ${s}` };
}

// ---------------- fast-import emission ----------------
const chunks: Buffer[] = [];
const emit = (s: string | Buffer) => chunks.push(typeof s === 'string' ? Buffer.from(s, 'utf8') : s);
const q = (p: string) => '"' + p.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
let mark = 0;
function commit(ref: string, ts: number, author: string, msg: string, ops: Op[], from?: string, merge?: string): string {
  const m = ++mark;
  const ident = `${author} <${author.split(' ')[0].toLowerCase()}@example.com> ${ts} +0000`;
  emit(`commit ${ref}\nmark :${m}\nauthor ${ident}\ncommitter ${ident}\n`);
  const mb = Buffer.from(msg, 'utf8'); emit(`data ${mb.length}\n`); emit(mb); emit('\n');
  if (from) emit(`from ${from}\n`);
  if (merge) emit(`merge ${merge}\n`);
  for (const o of ops) {
    if (o.t === 'M') { const b = Buffer.from(o.content, 'utf8'); emit(`M 100644 inline ${o.path}\ndata ${b.length}\n`); emit(b); emit('\n'); }
    else if (o.t === 'D') emit(`D ${o.path}\n`);
    else emit(`R ${q(o.from)} ${q(o.to)}\n`);
  }
  emit('\n');
  return `:${m}`;
}

let mainTip = '';
let mainCount = 0, featureCommits = 0, merges = 0;
let ts = BASE_TS;
function tick() { ts += 1800 + ri(7200); return ts; }
let changeIdx = 0;
while (mainCount < MAIN_COMMITS) {
  const c = next(changeIdx++);
  const author = AUTHORS[changeIdx % AUTHORS.length];
  const viaBranch = changeIdx > 120 && rnd() < 0.2;
  if (!viaBranch || c.ops.length === 0) {
    apply(c.ops);
    mainTip = commit('refs/heads/main', tick(), author, c.msg, c.ops, mainTip || undefined);
    mainCount++;
  } else {
    // feature branch: 1-3 commits (first = c, rest are extra edits to touched files), then --no-ff merge with a differing committer
    const branch = `refs/heads/feature/f${merges}`;
    const base = mainTip;
    const netOps: Op[] = [];
    let tip = '';
    const n = 1 + ri(3);
    let cur = c;
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        const tp = [...files.keys()].find((p) => /^[^/]+\/[^/]+\.txt$/.test(p) && cur.ops.some((o) => (o.t === 'M' && o.path === p) || (o.t === 'R' && o.to === p)));
        if (!tp) break;
        cur = { ops: [{ t: 'M', path: tp, content: editLines(files.get(tp)!, 'count') }], msg: `Follow-up on ${tp}` };
      }
      apply(cur.ops); netOps.push(...cur.ops);
      tip = commit(branch, tick(), AUTHORS[(changeIdx + k + 1) % AUTHORS.length], cur.msg, cur.ops, tip || base);
      featureCommits++;
    }
    // unrelated main commit before the merge (touches only README) so history is truly non-linear
    if (rnd() < 0.5) {
      const readme = `# Deck repo\nmain note ${ts}\n`;
      const saved = files.get('README.md');
      mainTip = commit('refs/heads/main', tick(), 'Eli Eriksen', 'Update README', [{ t: 'M', path: 'README.md', content: readme }], mainTip);
      files.set('README.md', readme); mainCount++; void saved;
    }
    mainTip = commit('refs/heads/main', tick(), 'Merge Bot', `Merge pull request #${merges + 1} from feature/f${merges}`, netOps, mainTip, tip);
    merges++; mainCount++;
  }
}
emit('done\n');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const git = (args: string[], input?: Buffer) => {
  const r = spawnSync('git', args, { cwd: outDir, input, maxBuffer: 1 << 30, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.toString();
};
git(['init', '-q', '-b', 'main']);
git(['fast-import', '--quiet', '--date-format=raw'], Buffer.concat(chunks));
git(['config', 'user.name', 'Spike']); git(['config', 'user.email', 'spike@example.com']);
git(['reset', '-q', '--hard', 'main']);
// fast-import leaves the feature branches as refs; keep them (like a real remote) but HEAD is main
console.log(JSON.stringify({ outDir, mainFirstParentCommits: mainCount, featureCommits, merges, stats, liveDecks: stems().length, deleted: stats.del }, null, 1));
writeFileSync(join(outDir, '..', 'generate-stats.json'), JSON.stringify({ mainCount, featureCommits, merges, stats, liveDecks: stems().length }, null, 1));
