// The disk cache of large card images for the proxy PDF. Fetches only from
// cards.scryfall.io, follows no redirects, at most 4 fetches at once.
import { mkdir, readdir, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { ENGINE_VERSION } from "@tcg-gauntlet/engine";
import { writeFileAtomic } from "@tcg-gauntlet/carddata";

export type Face = "front" | "back";
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ImageError";
  }
}

export interface ImageCacheOptions {
  /** `DATA_DIR/images`. */
  dir: string;
  maxBytes: number;
  /** Default `https://cards.scryfall.io`. Tests point it at a stub server. */
  upstream?: string;
  maxConcurrent?: number;
  fetchFn?: typeof fetch;
}

export class ImageCache {
  private readonly upstream: string;
  private readonly maxConcurrent: number;
  private readonly fetchFn: typeof fetch;
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly inflight = new Map<string, Promise<string>>();
  /** The most fetches that ran at once (for tests). */
  peak = 0;

  constructor(private readonly opts: ImageCacheOptions) {
    this.upstream = (opts.upstream ?? "https://cards.scryfall.io").replace(
      /\/+$/,
      "",
    );
    this.maxConcurrent = opts.maxConcurrent ?? 4;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  pathFor(id: string, face: Face): string {
    return join(this.opts.dir, face, id.charAt(0), `${id}.jpg`);
  }

  urlFor(id: string, face: Face): string {
    return `${this.upstream}/large/${face}/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`;
  }

  /** The path of the cached JPEG, fetching it first when needed. */
  async get(id: string, face: Face): Promise<string> {
    if (!UUID_RE.test(id)) throw new ImageError("bad id", 404);
    const path = this.pathFor(id, face);
    try {
      await stat(path);
      const now = new Date();
      await utimes(path, now, now);
      return path;
    } catch {
      // miss
    }
    const key = `${face}/${id}`;
    let p = this.inflight.get(key);
    if (p === undefined) {
      p = this.fetchAndStore(id, face, path).finally(() =>
        this.inflight.delete(key),
      );
      this.inflight.set(key, p);
    }
    return p;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent)
      await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  private async fetchAndStore(
    id: string,
    face: Face,
    path: string,
  ): Promise<string> {
    const bytes = await this.slot(async () => {
      let res: Response;
      try {
        res = await this.fetchFn(this.urlFor(id, face), {
          redirect: "error",
          headers: { "User-Agent": `tcg-gauntlet/${ENGINE_VERSION}` },
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        throw new ImageError(
          `upstream fetch failed: ${(e as Error).message}`,
          502,
        );
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new ImageError(
          `upstream answered ${res.status}`,
          res.status === 404 ? 404 : 502,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    });
    await mkdir(join(this.opts.dir, face, id.charAt(0)), { recursive: true });
    await writeFileAtomic(path, bytes);
    await this.evict().catch(() => undefined);
    return path;
  }

  /** Removes the files with the oldest mtime until the cache fits `maxBytes`. */
  async evict(): Promise<number> {
    const files: { path: string; size: number; mtime: number }[] = [];
    for (const face of ["front", "back"]) {
      let subs: string[];
      try {
        subs = await readdir(join(this.opts.dir, face));
      } catch {
        continue;
      }
      for (const sub of subs) {
        const dir = join(this.opts.dir, face, sub);
        for (const name of await readdir(dir).catch(() => [] as string[])) {
          if (!name.endsWith(".jpg")) continue;
          const st = await stat(join(dir, name)).catch(() => null);
          if (st !== null)
            files.push({
              path: join(dir, name),
              size: st.size,
              mtime: st.mtimeMs,
            });
        }
      }
    }
    let total = files.reduce((n, f) => n + f.size, 0);
    let removed = 0;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= this.opts.maxBytes) break;
      await unlink(f.path).catch(() => undefined);
      total -= f.size;
      removed++;
    }
    return removed;
  }
}
