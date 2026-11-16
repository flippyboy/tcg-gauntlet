// Timing for spike 4. Usage: node bench.ts   (needs out/repo from generate.ts)
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fullRebuild, incremental, git } from './history-pass.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out'); const repo = join(out, 'repo');
const N = 5;
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a: number[]) => `median ${med(a).toFixed(1)} ms (min ${Math.min(...a).toFixed(1)}, max ${Math.max(...a).toFixed(1)}, n=${a.length})`;
const res: Record<string, string> = {};

// 1. full rebuild
const dbp = join(out, 'bench.sqlite');
const wall: number[] = [], gitT: number[] = [], parse: number[] = [], ins: number[] = [];
let last: any;
for (let i = 0; i < N; i++) { const t = performance.now(); last = fullRebuild(repo, dbp); wall.push(performance.now() - t); gitT.push(last.gitMs); parse.push(last.parseMs); ins.push(last.insertMs); }
res['full rebuild wall (rev-parse + git log + parse + insert + rename)'] = fmt(wall);
res['  full: git log (spawn+collect)'] = fmt(gitT); res['  full: parse'] = fmt(parse); res['  full: insert (single transaction)'] = fmt(ins);
res['  full: commits with kept entries / rows'] = `${last.commits} / ${last.rows}`;
// raw git log to /dev/null from a shell for reference
const raw: number[] = [];
for (let i = 0; i < N; i++) { const t = performance.now(); spawnSync('sh', ['-c', "git log --first-parent --reverse -z --no-abbrev --raw -M --format=%x1e%H%x1f%an%x1f%aI%x1f%cI%x1f%s HEAD -- '*.txt' '*.md' > /dev/null"], { cwd: repo }); raw.push(performance.now() - t); }
res['git log alone to /dev/null (sh -c)'] = fmt(raw);
const outBytes = git(repo, ['log', '--first-parent', '--reverse', '-z', '--no-abbrev', '--raw', '-M', '--format=%x1e%H%x1f%an%x1f%aI%x1f%cI%x1f%s', '--', '*.txt', '*.md']).length;
res['git log output size'] = `${(outBytes / 1024).toFixed(0)} KiB`;

// 2. incremental after a 10-file push (one commit touching 10 decks) and after a 10-commit push of real history
const clone = join(out, 'bench-clone');
rmSync(clone, { recursive: true, force: true });
spawnSync('git', ['clone', '-q', '--no-local', repo, clone]);
const fp = git(clone, ['rev-list', '--first-parent', '--reverse', 'HEAD']).trim().split('\n');
const ENV = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'b', GIT_AUTHOR_EMAIL: 'b@x', GIT_COMMITTER_NAME: 'b', GIT_COMMITTER_EMAIL: 'b@x' };
const sg = (...a: string[]) => { const r = spawnSync('git', a, { cwd: clone, env: ENV }); if (r.status) throw new Error(String(r.stderr)); };
const base = join(out, 'bench-base.sqlite');
sg('reset', '-q', '--hard', fp[fp.length - 1]);
fullRebuild(clone, base);
const incTen: number[] = [], incTenParts: { g: number[]; p: number[]; i: number[] } = { g: [], p: [], i: [] };
const decks = git(clone, ['ls-files', '-z', '*.txt']).split('\0').filter((p) => /^[^/]+\/[^/]+\.txt$/.test(p));
for (let i = 0; i < N; i++) {
  copyFileSync(base, dbp); // db at the pre-push head
  for (const p of decks.slice(i * 10, i * 10 + 10)) writeFileSync(join(clone, p), readFileSync(join(clone, p), 'utf8') + `1 Push ${i} [LEA]\n`);
  sg('add', '-A'); sg('commit', '-qm', `push ${i}: 10 files`);
  const t = performance.now(); const r = incremental(clone, dbp)!; incTen.push(performance.now() - t);
  incTenParts.g.push(r.gitMs); incTenParts.p.push(r.parseMs); incTenParts.i.push(r.insertMs);
  sg('reset', '-q', '--hard', 'HEAD~1'); // back to base head for the next run
}
res['incremental after 10-file single-commit push (wall, incl. rev-parse, is-ancestor, open db)'] = fmt(incTen);
res['  inc: git log'] = fmt(incTenParts.g); res['  inc: parse'] = fmt(incTenParts.p); res['  inc: insert+commit'] = fmt(incTenParts.i);
const incTen2: number[] = [];
for (let i = 0; i < N; i++) {
  const upto = fp.length - 11 - i;
  sg('reset', '-q', '--hard', fp[upto]); fullRebuild(clone, base);
  copyFileSync(base, dbp); sg('reset', '-q', '--hard', fp[upto + 10]);
  const t = performance.now(); incremental(clone, dbp); incTen2.push(performance.now() - t);
}
res['incremental after a real 10-commit push (wall)'] = fmt(incTen2);
const noop: number[] = [];
for (let i = 0; i < N; i++) { copyFileSync(base, dbp); const t = performance.now(); incremental(clone, dbp); noop.push(performance.now() - t); }
void noop;

// 3. cat-file --batch vs cat-file -p for 500 blobs
const shas = [...new Set((new DatabaseSync(join(out, 'full.sqlite'), { readOnly: true }).prepare('SELECT blob_sha FROM deck_versions WHERE blob_sha IS NOT NULL').all() as any[]).map((r) => r.blob_sha as string))].slice(0, 500);
const batch: number[] = [], single: number[] = [];
const readBatch = () => new Promise<number>((resolve) => {
  const t = performance.now();
  const p = spawn('git', ['cat-file', '--batch'], { cwd: repo });
  let buf = Buffer.alloc(0), got = 0;
  p.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) { // parse "<sha> blob <size>\n<content>\n"
      const nl = buf.indexOf(10); if (nl < 0) break;
      const size = Number(buf.subarray(0, nl).toString().split(' ')[2]);
      if (buf.length < nl + 1 + size + 1) break;
      buf = buf.subarray(nl + 1 + size + 1); got++;
    }
    if (got === shas.length) { p.stdin.end(); }
  });
  p.on('close', () => resolve(performance.now() - t));
  for (const s of shas) p.stdin.write(s + '\n'); // one long-lived process, requests streamed
});
for (let i = 0; i < N; i++) {
  batch.push(await readBatch());
  const t = performance.now();
  for (const s of shas) spawnSync('git', ['cat-file', '-p', s], { cwd: repo, maxBuffer: 1 << 24 });
  single.push(performance.now() - t);
}
res['cat-file --batch, 500 blobs, one process (incl. spawn)'] = fmt(batch);
res['500 x git cat-file -p (500 spawns)'] = fmt(single);

// 4. sizes
const sh = (c: string) => spawnSync('sh', ['-c', c], { cwd: out }).stdout.toString().trim();
res['repo .git on disk'] = sh('du -sk repo/.git | cut -f1') + ' KiB (' + sh('git -C repo count-objects -v | grep size-pack') + '); working tree files: ' + sh('git -C repo ls-files | wc -l') + '; objects: ' + sh('git -C repo count-objects -v | grep in-pack');
res['history.sqlite size'] = `${(statSync(join(out, 'full.sqlite')).size / 1024).toFixed(0)} KiB`;
res['commits (first-parent / all)'] = `${git(repo, ['rev-list', '--first-parent', '--count', 'HEAD']).trim()} / ${git(repo, ['rev-list', '--count', 'HEAD']).trim()}`;
for (const [k, v] of Object.entries(res)) console.log(`${k}: ${v}`);
writeFileSync(join(out, 'bench-results.txt'), Object.entries(res).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');
