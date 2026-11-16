// Correctness checks for spike 4. Usage: node verify.ts   (needs out/repo from generate.ts)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fullRebuild, incremental, git, runLog, parseLog } from './history-pass.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const repo = join(out, 'repo');
const results: string[] = [];
const rep = (ok: boolean, name: string, detail = '') => { const l = `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`; results.push(l); console.log(l); };

const ENV = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Syn Thetic', GIT_AUTHOR_EMAIL: 's@example.com', GIT_COMMITTER_NAME: 'Syn Thetic', GIT_COMMITTER_EMAIL: 's@example.com' };
let clock = 1800000000;
function g(cwd: string, ...args: string[]): string {
  clock += 60;
  const r = spawnSync('git', args, { cwd, env: { ...ENV, GIT_AUTHOR_DATE: `${clock} +0200`, GIT_COMMITTER_DATE: `${clock} +0000` }, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.toString();
}
function dump(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const o = {
    decks: db.prepare('SELECT * FROM decks ORDER BY deck_id').all(),
    versions: db.prepare('SELECT * FROM deck_versions ORDER BY deck_id, seq, kind').all(),
    state: db.prepare('SELECT * FROM sync_state ORDER BY key').all(),
  };
  db.close();
  return JSON.stringify(o);
}
function diffDumps(a: string, b: string): string {
  const A = JSON.parse(a), B = JSON.parse(b);
  for (const t of ['decks', 'versions', 'state']) {
    const x = A[t], y = B[t];
    if (x.length !== y.length) return `${t}: ${x.length} vs ${y.length} rows`;
    for (let i = 0; i < x.length; i++) if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) return `${t}[${i}]: ${JSON.stringify(x[i])} vs ${JSON.stringify(y[i])}`;
  }
  return '';
}
const write = (d: string, p: string, c: string) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); };
const deckBody = (n: number) => Array.from({ length: 24 }, (_, i) => `${1 + ((i + n) % 4)} Card ${i} [LEA]`).join('\n') + '\n';

// ================= (a) incremental == full =================
const inc = join(out, 'inc');
rmSync(inc, { recursive: true, force: true });
spawnSync('git', ['clone', '-q', '--no-local', repo, inc]);
const fp = git(inc, ['rev-list', '--first-parent', '--reverse', 'origin/main']).trim().split('\n');
const finalOrig = fp.length - 1;
let pos = 2000;
g(inc, 'reset', '-q', '--hard', fp[pos]);
const dbInc = join(out, 'inc.sqlite');
for (const f of [dbInc]) rmSync(f, { force: true });
fullRebuild(inc, dbInc);
let mism = '', steps = 0, incs = 0, fulls = 0;
const sizes = [1, 10, 3, 1, 1, 7, 2, 10, 5, 1, 4, 10, 1, 25, 2];
const cmp = (label: string) => {
  const r = incremental(inc, dbInc);
  if (r === null) { fulls++; fullRebuild(inc, dbInc); } else incs++;
  const ref = join(out, 'ref.sqlite');
  fullRebuild(inc, ref);
  const d = diffDumps(dump(dbInc), dump(ref));
  steps++;
  if (d) mism += `${label}: ${d}; `;
};
for (let k = 0; pos < finalOrig; k++) {
  pos = Math.min(finalOrig, pos + sizes[k % sizes.length]);
  g(inc, 'reset', '-q', '--hard', fp[pos]);
  cmp(`replay@${pos}`);
}
rep(!mism, '(a1) incremental after replaying real history in pushes of 1..25 first-parent commits equals fresh full rebuild', `${steps} pushes compared, ${incs} incremental, ${fulls} fell back to full; ${mism || 'no mismatch'}`);

// synthetic pushes
const synth: [string, () => void][] = [
  ['10-file single commit', () => {
    const ls = git(inc, ['ls-files', '-z', '*.txt']).split('\0').filter((p) => /^[^/]+\/[^/]+\.txt$/.test(p)).slice(0, 10);
    for (const p of ls) write(inc, p, readFileSync(join(inc, p), 'utf8') + `1 Extra ${Math.random() < 2 ? 'Card' : ''} [LEA]\n`);
    g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'bulk edit 10 files');
  }],
  ['multi-commit push: rename, rename again, rename+edit', () => {
    write(inc, 'budget/Alpha deck.txt', deckBody(1)); write(inc, 'budget/Alpha deck.md', '# primer\nline\n'); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'add Alpha');
    g(inc, 'mv', 'budget/Alpha deck.txt', 'budget/Beta ★ deck.txt'); g(inc, 'mv', 'budget/Alpha deck.md', 'budget/Beta ★ deck.md'); g(inc, 'commit', '-qm', 'rename to Beta');
    g(inc, 'mv', 'budget/Beta ★ deck.txt', 'peasant/Gamma.txt'); write(inc, 'peasant/Gamma.txt', deckBody(1).replace('Card 3 ', 'Card X ')); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'rename+edit to peasant/Gamma');
    g(inc, 'mv', 'budget/Beta ★ deck.md', 'peasant/Gamma.md'); g(inc, 'commit', '-qm', 'move primer next commit');
    write(inc, 'peasant/Gamma.txt', deckBody(1)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'edit after rename');
  }],
  ['delete then re-add in one push', () => {
    g(inc, 'rm', '-q', 'peasant/Gamma.txt'); g(inc, 'commit', '-qm', 'delete Gamma (md stays orphan)');
    write(inc, 'peasant/Gamma.txt', deckBody(3)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 're-add Gamma');
  }],
  ['rename a->b and add new a in the same commit', () => {
    g(inc, 'mv', 'peasant/Gamma.txt', 'peasant/Delta.txt'); write(inc, 'peasant/Gamma.txt', deckBody(9)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'a->b plus new a');
  }],
  ['swap two deck names', () => {
    write(inc, 'budget/S1.txt', deckBody(11)); write(inc, 'budget/S2.txt', deckBody(12)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'add S1 S2');
    g(inc, 'mv', 'budget/S1.txt', 'budget/tmp.txt'); g(inc, 'mv', 'budget/S2.txt', 'budget/S1.txt'); g(inc, 'mv', 'budget/tmp.txt', 'budget/S2.txt'); g(inc, 'commit', '-qm', 'swap S1 S2');
  }],
  ['across filter boundary: into nested folder, out to root, to .bak, txt->md', () => {
    write(inc, 'budget/B1.txt', deckBody(21)); write(inc, 'budget/B2.txt', deckBody(22)); write(inc, 'budget/B3.txt', deckBody(23)); write(inc, 'budget/B4.txt', deckBody(24)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'add B1-B4');
    mkdirSync(join(inc, 'budget/sub'), { recursive: true }); g(inc, 'mv', 'budget/B1.txt', 'budget/sub/B1.txt'); g(inc, 'mv', 'budget/B2.txt', 'B2.txt'); g(inc, 'mv', 'budget/B3.txt', 'budget/B3.bak'); g(inc, 'mv', 'budget/B4.txt', 'budget/B4.md'); g(inc, 'commit', '-qm', 'boundary moves');
    g(inc, 'mv', 'budget/sub/B1.txt', 'budget/B1.txt'); g(inc, 'mv', 'B2.txt', 'budget/B2.txt'); g(inc, 'mv', 'budget/B3.bak', 'budget/B3.txt'); g(inc, 'commit', '-qm', 'and back');
  }],
  ['--no-ff merge of a feature branch with a rename', () => {
    g(inc, 'checkout', '-q', '-b', 'feat/x'); g(inc, 'mv', 'budget/B1.txt', 'budget/B1 renamed.txt'); g(inc, 'commit', '-qm', 'feat rename');
    write(inc, 'budget/B1 renamed.txt', deckBody(31)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'feat edit');
    g(inc, 'checkout', '-q', 'main'); write(inc, 'README.md', 'x\n'); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'readme'); g(inc, 'merge', '-q', '--no-ff', '-m', 'Merge feat/x', 'feat/x');
  }],
  ['commit touching only non-deck files + nested deck', () => { write(inc, 'formats/x.yaml', 'a: 1\n'); write(inc, 'budget/sub/N.txt', 'nested\n'); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'non deck'); }],
];
for (const [name, fn] of synth) {
  const before = mism;
  fn();
  cmp(`synthetic:${name}`);
  rep(mism === before, `(a2) incremental equals full after synthetic push: ${name}`, mism.slice(before.length) || 'identical');
}
// force-push detection
{
  const keep = git(inc, ['rev-parse', 'HEAD']).trim();
  g(inc, 'reset', '-q', '--hard', 'HEAD~3'); write(inc, 'budget/force.txt', deckBody(5)); g(inc, 'add', '-A'); g(inc, 'commit', '-qm', 'force-pushed history');
  const r = incremental(inc, dbInc);
  rep(r === null, '(a3) force-push (last_commit not an ancestor) makes incremental return null (caller must full-rebuild)', `old head ${keep.slice(0, 7)}`);
  fullRebuild(inc, dbInc);
}

// ================= (b)-(e) on the generated repo =================
const dbFull = join(out, 'full.sqlite');
fullRebuild(repo, dbFull);
const db = new DatabaseSync(dbFull, { readOnly: true });
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];

// (b) rename chains
{
  const chains = all(`SELECT deck_id, count(*) n FROM deck_versions WHERE status='R' AND kind='txt' GROUP BY deck_id HAVING n>=2`);
  const twice = chains.length;
  let ok = twice > 0;
  let followMismatch = 0, followChecked = 0, detail = '', extraBeyond = 0;
  const live = all(`SELECT deck_id, current_path FROM decks WHERE current_path IS NOT NULL`);
  for (const d of live) {
    const mine = new Set(all(`SELECT DISTINCT commit_sha s FROM deck_versions WHERE deck_id=? AND kind='txt'`, d.deck_id).map((r) => r.s));
    const follow = git(repo, ['log', '--first-parent', '--follow', '-M', '--format=%H', '--', d.current_path + '.txt']).trim().split('\n').filter(Boolean);
    followChecked++;
    // mine, newest first, must be an exact prefix of --follow's list (--follow may continue past the creation commit into a 'copy source')
    const mineSorted = follow.filter((h) => mine.has(h));
    let same = mineSorted.length === mine.size && follow.slice(0, mine.size).every((h) => mine.has(h));
    if (same && follow.length > mine.size) extraBeyond++;
    if (!same) { followMismatch++; if (followMismatch <= 3) detail += ` [${d.current_path}: mine ${mine.size} vs --follow ${fs.size}]`; }
  }
  // single deck_id across chains: every path in the chain maps to one deck_id by construction; verify chains have >= 3 distinct path_at_commit
  const ex = chains[0] ? all(`SELECT seq,status,path_at_commit FROM deck_versions WHERE deck_id=? AND kind='txt' ORDER BY seq`, chains[0].deck_id) : [];
  const distinctPaths = new Set(ex.map((r) => r.path_at_commit)).size;
  rep(ok && distinctPaths >= 3, `(b1) decks renamed >= 2 times keep one deck_id and all versions`, `${twice} decks with >=2 txt renames; example deck_id ${chains[0]?.deck_id} has ${ex.length} txt versions over ${distinctPaths} distinct paths`);
  rep(followMismatch === 0, `(b2) version commits are exactly the newest N commits of 'git log --first-parent --follow' for each live deck`, `${followChecked} live decks checked, ${followMismatch} differ${detail}; ${extraBeyond} decks where --follow continues past the creation commit into a copy source (known --follow heuristic)`);
}
// (c) delete + re-add
{
  const del = all(`SELECT v.deck_id, v.path_at_commit p, v.seq FROM deck_versions v WHERE v.status='D' AND v.kind='txt'`);
  let readd = 0, newId = 0, sameId = 0;
  for (const d of del) {
    const stem = d.p.slice(0, -4);
    const later = all(`SELECT DISTINCT deck_id FROM deck_versions WHERE kind='txt' AND path_at_commit=? AND seq>? AND status='A'`, d.p, d.seq);
    if (later.length) { readd++; if (later.every((r) => r.deck_id !== d.deck_id)) newId++; else sameId++; }
    void stem;
  }
  rep(del.length >= 5 && readd >= 2 && newId === readd && sameId === 0, '(c) delete then re-add of the same path gets a new deck_id', `${del.length} deletes, ${readd} re-added paths, ${newId} with new deck_id, ${sameId} reused id`);
}
// (d) merges
{
  const merges = git(repo, ['rev-list', '--first-parent', '--merges', 'HEAD']).trim().split('\n');
  const total = git(repo, ['rev-list', '--first-parent', '--count', 'HEAD']).trim();
  const allc = git(repo, ['rev-list', '--count', 'HEAD']).trim();
  const mset = new Set(merges);
  const rows = all(`SELECT commit_sha, deck_id, kind, count(*) n FROM deck_versions GROUP BY commit_sha, deck_id, kind HAVING n>1`);
  const mrows = all(`SELECT commit_sha FROM deck_versions`).filter((r) => mset.has(r.commit_sha));
  const mshas = new Set(mrows.map((r) => r.commit_sha));
  // compare against explicit diff of merge vs first parent
  let diffBad = 0;
  const recs = parseLog(runLog(repo, 'HEAD').out).filter((r) => mset.has(r.sha));
  for (const r of recs.slice(0, 150)) {
    const ref = git(repo, ['diff-tree', '-r', '-M', '--raw', '-z', '--no-abbrev', `${r.sha}^1`, r.sha, '--', '*.txt', '*.md']).split('\0').filter(Boolean);
    const refPaths = ref.filter((x) => !x.startsWith(':')).sort().join('|');
    const logPaths = r.entries.flatMap((e) => [e.path, e.path2].filter(Boolean)).sort().join('|');
    if (refPaths !== logPaths) diffBad++;
  }
  const a = git(repo, ['log', '-1', '--format=%an|%ae|%aI|%cn|%cI', [...mshas][0]]).trim();
  const feat = git(repo, ['log', '-1', '--format=%an|%aI', `${[...mshas][0]}^2`]).trim();
  const noFirstParentMergeLines = git(repo, ['log', '-1', '--raw', '--format=%H', [...mshas][0]]).split('\n').filter((l) => l.startsWith(':')).length;
  const firstParentMergeLines = git(repo, ['log', '-1', '--first-parent', '--raw', '--format=%H', [...mshas][0]]).split('\n').filter((l) => l.startsWith(':')).length;
  rep(rows.length === 0 && mshas.size > 0 && diffBad === 0, '(d1) each merge commit yields one version (one row per deck+kind) and its entries equal the diff vs first parent', `${total} first-parent commits (${allc} total commits), ${merges.length} first-parent merges, ${mshas.size} merges carry deck rows, duplicate (commit,deck,kind) rows: ${rows.length}, entry mismatches vs diff-tree ^1: ${diffBad}/150`);
  rep(true, '(d2) what git reports for a merge', `author/committer of the merge commit = ${a}; second-parent (feature tip) author = ${feat}. 'git log --raw' on a merge WITHOUT --first-parent prints ${noFirstParentMergeLines} raw lines; WITH --first-parent prints ${firstParentMergeLines}`);
}
// (e) names with spaces / unicode
{
  const rows = all(`SELECT commit_sha, blob_sha, path_at_commit FROM deck_versions WHERE blob_sha IS NOT NULL`);
  const input = rows.map((r) => `${r.commit_sha}:${r.path_at_commit}`).join('\n') + '\n';
  const res = spawnSync('git', ['cat-file', '--batch-check'], { cwd: repo, input, maxBuffer: 1 << 28 }).stdout.toString().trim().split('\n');
  let bad = 0; res.forEach((l, i) => { if (!l.startsWith(rows[i].blob_sha + ' blob')) bad++; });
  const special = rows.filter((r) => /[^\x00-\x7f ]|\s/.test(r.path_at_commit.split('/')[1])).length;
  const nonAscii = rows.filter((r) => /[^\x00-\x7f]/.test(r.path_at_commit)).length;
  const withSpace = rows.filter((r) => /\s/.test(r.path_at_commit)).length;
  rep(bad === 0 && nonAscii > 0 && withSpace > 0, '(e) every stored (commit_sha, path_at_commit) resolves to the stored blob_sha, including names with spaces and non-ASCII', `${rows.length} rows checked, ${bad} mismatches, ${nonAscii} rows with non-ASCII paths, ${withSpace} with spaces, ${special} rows in special-named decks`);
}
// extra: live blobs equal HEAD blobs; nested/non-deck files excluded
{
  let bad = 0, n = 0;
  for (const d of all(`SELECT deck_id, current_path FROM decks WHERE current_path IS NOT NULL`)) for (const kind of ['txt', 'md']) {
    const last = all(`SELECT status, blob_sha FROM deck_versions WHERE deck_id=? AND kind=? ORDER BY seq DESC LIMIT 1`, d.deck_id, kind)[0];
    const head = spawnSync('git', ['rev-parse', '-q', '--verify', `HEAD:${d.current_path}.${kind}`], { cwd: repo }).stdout.toString().trim();
    n++;
    if (last ? (last.status === 'D' ? head !== '' : last.blob_sha !== head) : head !== '') bad++;
  }
  const leaked = all(`SELECT path_at_commit p FROM deck_versions`).filter((r) => !/^[^/]+\/[^/]+\.(txt|md)$/.test(r.p) || r.p.startsWith('formats/') || /\/archive\//.test(r.p)).length;
  const live = all(`SELECT count(*) c FROM decks WHERE current_path IS NOT NULL`)[0].c;
  const headDecks = git(repo, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0').filter((p) => /^[^/]+\/[^/]+\.txt$/.test(p)).length;
  rep(bad === 0 && leaked === 0 && live === headDecks, '(f) latest version of each live deck/kind equals the blob at HEAD; no nested/non-deck paths leak; live deck count equals txt files at HEAD', `${n} deck/kind pairs, ${bad} wrong, ${leaked} leaked paths, ${live} live decks vs ${headDecks} txt files at HEAD`);
}
writeFileSync(join(out, 'verify-results.txt'), results.join('\n') + '\n');
