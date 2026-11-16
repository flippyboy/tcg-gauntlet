// Process-wide singletons that the routes share, and the helpers every route uses.
import { join } from "node:path";
import { error } from "@sveltejs/kit";
import { type Config, getConfig } from "./config.js";
import { ImageCache } from "./image-cache.js";
import { RateLimiter } from "./rate-limit.js";
import {
  type DeckEntry,
  type GauntletEntry,
  type Snapshot,
  findDeck,
  findGauntlet,
  getSnapshot,
} from "./snapshot.js";

let images: ImageCache | undefined;
let limiter: RateLimiter | undefined;

export function getImageCache(config: Config = getConfig()): ImageCache {
  images ??= new ImageCache({
    dir: join(config.dataDir, "images"),
    maxBytes: config.imageCacheMaxMb * 1024 * 1024,
    upstream: config.imageUpstream,
  });
  return images;
}

export function getRateLimiter(): RateLimiter {
  limiter ??= new RateLimiter(120);
  return limiter;
}

/** For tests. */
export function setImageServices(
  i: ImageCache | undefined,
  l: RateLimiter | undefined,
): void {
  images = i;
  limiter = l;
}

/** The snapshot, or a 503 "Preparing data" before the first one exists. */
export function requireSnapshot(): Snapshot {
  const s = getSnapshot();
  if (s === null) error(503, "Preparing data");
  return s;
}

/** The snapshot, a gauntlet and a deck, or 503 / 404. */
export function requireDeck(
  gauntlet: string,
  deck: string,
): { snap: Snapshot; g: GauntletEntry; d: DeckEntry } {
  const snap = requireSnapshot();
  const g = findGauntlet(snap, gauntlet);
  if (g === undefined) error(404, "Gauntlet not found");
  const d = findDeck(g, deck);
  if (d === undefined) error(404, "Deck not found");
  return { snap, g, d };
}
