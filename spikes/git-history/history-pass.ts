// Implementation of the design's "one history pass" (Technical Plan, History in history.sqlite).
// Library + CLI:  node history-pass.ts full <repo> <db>   |   node history-pass.ts inc <repo> <db>
import { spawnSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const GIT_LOG_ARGS = ['log', '--first-parent', '--reverse', '-z', '--no-abbrev', '--raw', '-M', '--format=%x1e%H%x1f%an%x1f%aI%x1f%cI%x1f%s'];
export const PATHSPEC = ['--', '*.txt', '*.md'];

export type Entry = { status: string; oldSha: string; newSha: string; path: string; path2?: string };
export type CommitRec = { sha: string; author: string; authorDate: string; committerDate: string; subject: string; entries: Entry[] };

const SAFE = ['-c', 'core.quotepath=false', '-c', 'diff.renames=true', '-c', 'diff.renameLimit=0'];
export function git(repo: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync('git', [...SAFE, ...args], { cwd: repo, maxBuffer: 1 << 30, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.status === 0 ? r.stdout.toString('utf8') : '';
}

/** Run the documented command. Returns raw output and wall time. */
export function runLog(repo: string, range: string): { out: string; ms: number } {
  const t = performance.now();
  const r = spawnSync('git', [...SAFE, ...GIT_LOG_ARGS, range, ...PATHSPEC], { cwd: repo, maxBuffer: 1 << 30, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  if (r.status !== 0) throw new Error(`git log failed: ${r.stderr}`);
  return { out: r.stdout.toString('utf8'), ms: performance.now() - t };
}

/** Parse `--raw -z` output with \x1e record separators. */
export function parseLog(out: string): CommitRec[] {
  const recs: CommitRec[] = [];
  for (const chunk of out.split('\x1e')) {
    if (chunk === '') continue;
    const nul = chunk.indexOf('\0');
    const header = nul < 0 ? chunk : chunk.slice(0, nul);
    const [sha, author, authorDate, committerDate, ...subj] = header.split('\x1f');
    const rec: CommitRec = { sha, author, authorDate, committerDate, subject: subj.join('\x1f'), entries: [] };
    if (nul >= 0) {
      // after the header NUL comes "\n" (separator before the raw block), then NUL-terminated tokens
      const toks = chunk.slice(nul + 1).split('\0');
      let i = 0;
      if (toks[0] === '\n') i = 1; else if (toks[0].startsWith('\n')) toks[0] = toks[0].slice(1);
      while (i < toks.length) {
        const meta = toks[i];
        if (meta === '' || meta === '\n') { i++; continue; }
        if (!meta.startsWith(':')) throw new Error(`parse error near ${sha}: ${JSON.stringify(meta)}`);
        const f = meta.slice(1).split(' '); // oldmode newmode oldsha newsha status
        const status = f[4];
        const e: Entry = { status, oldSha: f[2], newSha: f[3], path: toks[i + 1] };
        i += 2;
        if (status[0] === 'R' || status[0] === 'C') { e.path2 = toks[i]; i++; }
        rec.entries.push(e);
      }
    }
    recs.push(rec);
  }
  return recs;
}

// ---------- path filter ----------
export type Parsed = { gauntlet: string; stem: string; kind: 'txt' | 'md' };
export function classify(p: string | undefined): Parsed | null {
  if (!p) return null;
  const m = /^([^/]+)\/([^/]+)\.(txt|md)$/.exec(p);
  if (!m) return null;
  return { gauntlet: m[1], stem: `${m[1]}/${m[2]}`, kind: m[3] as 'txt' | 'md' };
}

// ---------- schema ----------
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS decks(deck_id INTEGER PRIMARY KEY, current_path TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS deck_versions(
      deck_id INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('txt','md')),
      status TEXT NOT NULL CHECK(status IN ('A','M','D','R')), commit_sha TEXT NOT NULL, blob_sha TEXT,
      path_at_commit TEXT NOT NULL, author_name TEXT NOT NULL, author_date TEXT NOT NULL, committer_date TEXT NOT NULL, subject TEXT NOT NULL,
      PRIMARY KEY(deck_id, seq, kind)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS deck_versions_commit ON deck_versions(commit_sha);
  `);
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('tool_schema','1')").run();
  return db;
}

const ZERO = /^0+$/;
type Act = { op: 'A' | 'M' | 'D' | 'R'; kind: 'txt' | 'md'; path: string; blob: string | null; fromStem?: string; stem: string };

/**
 * Deck lifecycle follows the .txt file: a deck row is created by a txt A (or M/R with no row), its path moves with txt R,
 * and a txt D ends it (current_path -> NULL). A .md primer is a second "kind" of the deck at the same stem; a primer
 * event whose stem has no live deck is dropped (orphan primer). One seq per commit that has at least one kept entry.
 */
export class Applier {
  private q;
  constructor(db: DatabaseSync) {
    this.q = {
      byPath: db.prepare('SELECT deck_id FROM decks WHERE current_path=?'),
      newDeck: db.prepare('INSERT INTO decks(current_path) VALUES(?)'),
      setPath: db.prepare('UPDATE decks SET current_path=? WHERE deck_id=?'),
      kill: db.prepare('UPDATE decks SET current_path=NULL WHERE deck_id=?'),
      ins: db.prepare('INSERT INTO deck_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)'),
    };
  }
  private deckAt(stem: string): number | undefined {
    return (this.q.byPath.get(stem) as { deck_id: number } | undefined)?.deck_id;
  }
  private actions(rec: CommitRec): Act[] {
    const acts: Act[] = [];
    for (const e of rec.entries) {
      const s = e.status[0];
      const blob = ZERO.test(e.newSha) ? null : e.newSha;
      if (s === 'R') {
        const a = classify(e.path), b = classify(e.path2);
        if (a && b && a.kind === b.kind) acts.push({ op: 'R', kind: a.kind, path: e.path2!, blob, fromStem: a.stem, stem: b.stem });
        else { // kind change, or the other side is outside the filter (nested folder, root, other extension): D old + A new
          if (a) acts.push({ op: 'D', kind: a.kind, path: e.path, blob: null, stem: a.stem });
          if (b) acts.push({ op: 'A', kind: b.kind, path: e.path2!, blob, stem: b.stem });
        }
      } else if (s === 'C') { const b = classify(e.path2); if (b) acts.push({ op: 'A', kind: b.kind, path: e.path2!, blob, stem: b.stem }); }
      else {
        const a = classify(e.path);
        if (a) acts.push({ op: s === 'D' ? 'D' : s === 'A' ? 'A' : 'M', kind: a.kind, path: e.path, blob: s === 'D' ? null : blob, stem: a.stem });
      }
    }
    // txt before md; within a kind: detach (D, R) before attach (A, M), whatever order git printed
    const rank = (x: Act) => (x.kind === 'txt' ? 0 : 10) + (x.op === 'D' || x.op === 'R' ? 0 : 1);
    return acts.sort((x, y) => rank(x) - rank(y));
  }
  apply(rec: CommitRec, seq: number): boolean {
    const acts = this.actions(rec);
    let used = false;
    const put = (id: number, a: Act, status: string) => {
      this.q.ins.run(id, seq, a.kind, status, rec.sha, status === 'D' ? null : a.blob, a.path, rec.author, rec.authorDate, rec.committerDate, rec.subject);
      used = true;
    };
    for (const a of acts) {
      if (a.kind === 'txt') {
        if (a.op === 'R') {
          let id = this.deckAt(a.fromStem!);
          if (id === undefined) { this.q.newDeck.run(a.stem); id = this.deckAt(a.stem)!; put(id, a, 'A'); }
          else { if (a.fromStem !== a.stem) this.q.setPath.run(a.stem, id); put(id, a, 'R'); }
        } else if (a.op === 'D') {
          const id = this.deckAt(a.stem);
          if (id === undefined) continue;
          put(id, a, 'D'); this.q.kill.run(id);
        } else {
          let id = this.deckAt(a.stem);
          if (id === undefined) { this.q.newDeck.run(a.stem); id = this.deckAt(a.stem)!; put(id, a, 'A'); }
          else put(id, a, a.op === 'A' ? 'M' : a.op); // A on a live path cannot happen in git; record as M
        }
      } else {
        if (a.op === 'R') {
          const to = this.deckAt(a.stem), from = this.deckAt(a.fromStem!);
          if (to !== undefined && (from === undefined || from === to)) put(to, a, 'R'); // primer follows its deck
          else { // primer moved away from a deck that stayed: D at old stem, A at new stem (if a deck lives there)
            if (from !== undefined) put(from, { ...a, path: a.fromStem + '.md', blob: null }, 'D');
            if (to !== undefined) put(to, a, 'A');
          }
        } else {
          const id = this.deckAt(a.stem);
          if (id === undefined) continue;
          put(id, a, a.op);
        }
      }
    }
    return used;
  }
}

export type Timing = { gitMs: number; parseMs: number; insertMs: number; commits: number; rows: number };

function applyRange(db: DatabaseSync, repo: string, range: string, endSha: string, startSeq: number): Timing {
  const { out, ms: gitMs } = runLog(repo, range);
  const t1 = performance.now();
  const recs = parseLog(out);
  const parseMs = performance.now() - t1;
  const t2 = performance.now();
  const ap = new Applier(db);
  let seq = startSeq;
  db.exec('BEGIN');
  try {
    for (const r of recs) { if (ap.apply(r, seq + 1)) seq++; }
    const up = db.prepare('INSERT OR REPLACE INTO sync_state(key,value) VALUES(?,?)');
    up.run('last_commit', endSha); up.run('last_seq', String(seq));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const insertMs = performance.now() - t2;
  const rows = (db.prepare('SELECT count(*) c FROM deck_versions').get() as { c: number }).c;
  return { gitMs, parseMs, insertMs, commits: recs.length, rows };
}

export function fullRebuild(repo: string, dbPath: string, head = 'HEAD'): Timing {
  const endSha = git(repo, ['rev-parse', head]).trim();
  const tmp = dbPath + '.tmp';
  for (const f of [tmp, tmp + '-wal', tmp + '-shm', tmp + '-journal']) rmSync(f, { force: true });
  const db = openDb(tmp);
  const t = applyRange(db, repo, endSha, endSha, 0);
  db.close();
  renameSync(tmp, dbPath);
  return t;
}

/** Returns null when an incremental update is impossible (caller must full-rebuild). */
export function incremental(repo: string, dbPath: string, head = 'HEAD'): Timing | null {
  if (!existsSync(dbPath)) return null;
  const db = openDb(dbPath);
  try {
    const g = (k: string) => (db.prepare('SELECT value FROM sync_state WHERE key=?').get(k) as { value: string } | undefined)?.value;
    const last = g('last_commit'); const lastSeq = Number(g('last_seq') ?? 0);
    if (!last) return null;
    const endSha = git(repo, ['rev-parse', head]).trim();
    const anc = spawnSync('git', ['merge-base', '--is-ancestor', last, endSha], { cwd: repo });
    if (anc.status !== 0) return null; // force-push or missing object
    if (last === endSha) return { gitMs: 0, parseMs: 0, insertMs: 0, commits: 0, rows: 0 };
    return applyRange(db, repo, `${last}..${endSha}`, endSha, lastSeq);
  } finally { db.close(); }
}

if (process.argv[1]?.endsWith('history-pass.ts') && process.argv[2]) {
  const [, , mode, repo, db] = process.argv;
  console.log(JSON.stringify(mode === 'full' ? fullRebuild(repo, db) : incremental(repo, db)));
}
