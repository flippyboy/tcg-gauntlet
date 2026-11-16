// The proxy PDF, built in the browser with pdf-lib (Technical Plan, "Images and the
// proxy PDF"). Everything here is plain TypeScript: the layout math and the fetch
// queue are exported so tests can run them without a browser.
import { PDFDocument, type PDFImage, StandardFonts, rgb } from "pdf-lib";

export type Paper = "a4" | "letter";

/** Paper sizes in millimetres (width, height). */
export const PAPER_MM: Readonly<Record<Paper, { w: number; h: number }>> = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

export const CARD_W_MM = 63;
export const CARD_H_MM = 88;
export const COLUMNS = 3;
export const ROWS = 3;
export const CARDS_PER_PAGE = COLUMNS * ROWS;
/** Cut marks are 0.2 mm wide and reach this far into the margin. */
export const CUT_LINE_MM = 0.2;
export const CUT_MARK_LENGTH_MM = 3;
export const MARGIN_NOTE = "Proxy — not for sale";
export const MARGIN_NOTE_SIZE_PT = 7;
const PT_PER_MM = 72 / 25.4;
/** Fetches that run at the same time. The server's image route allows 4 as well. */
export const FETCH_CONCURRENCY = 4;

export const mmToPt = (mm: number): number => mm * PT_PER_MM;

export type Face = "front" | "back";

/** One card of the deck: a printing, how many copies, and whether it has a back. */
export interface ProxyEntry {
  scryfallId: string;
  count: number;
  hasBackFace: boolean;
}

export interface Slot {
  id: string;
  face: Face;
}

export interface BuildProgress {
  phase: "fetch" | "build";
  done: number;
  total: number;
}

export interface BuildOptions {
  paper: Paper;
  cutLines: boolean;
  marginNote: boolean;
  onProgress?: (p: BuildProgress) => void;
  /** Defaults to the global `fetch`. Tests pass a stub. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Waits before a retry. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

/** Each card `count` times, front first, then its back faces. */
export function expandSlots(entries: readonly ProxyEntry[]): Slot[] {
  const out: Slot[] = [];
  for (const e of entries) {
    for (let i = 0; i < e.count; i++)
      out.push({ id: e.scryfallId, face: "front" });
    if (e.hasBackFace)
      for (let i = 0; i < e.count; i++)
        out.push({ id: e.scryfallId, face: "back" });
  }
  return out;
}

/** The distinct images the slots need, in first-use order. */
export function uniqueImages(slots: readonly Slot[]): Slot[] {
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const s of slots) {
    const k = imageKey(s);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export const imageKey = (s: Slot): string => `${s.id}/${s.face}`;
export const imagePath = (s: Slot): string => `/img/${s.id}/${s.face}`;

export const pageCount = (cards: number): number =>
  Math.ceil(cards / CARDS_PER_PAGE);

/** The space around the 3×3 grid, in millimetres. */
export function margins(paper: Paper): { x: number; y: number } {
  const p = PAPER_MM[paper];
  return {
    x: (p.w - COLUMNS * CARD_W_MM) / 2,
    y: (p.h - ROWS * CARD_H_MM) / 2,
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The slot of the n-th card on its page, in millimetres from the top left of the
 * page. Cards fill rows left to right, then top to bottom.
 */
export function slotRect(indexOnPage: number, paper: Paper): Rect {
  const m = margins(paper);
  const col = indexOnPage % COLUMNS;
  const row = Math.floor(indexOnPage / COLUMNS);
  return {
    x: m.x + col * CARD_W_MM,
    y: m.y + row * CARD_H_MM,
    w: CARD_W_MM,
    h: CARD_H_MM,
  };
}

/** An image of the given pixel size, scaled to fit the slot and centred in it. */
export function fitInSlot(slot: Rect, imgW: number, imgH: number): Rect {
  const scale = Math.min(slot.w / imgW, slot.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Cut marks in millimetres from the top left of the page. Each of the 4 vertical and
 * 4 horizontal card edges gets a mark at each end, inside the margin only, so no
 * mark touches a card.
 */
export function cutMarks(paper: Paper): Segment[] {
  const m = margins(paper);
  const left = m.x;
  const right = m.x + COLUMNS * CARD_W_MM;
  const top = m.y;
  const bottom = m.y + ROWS * CARD_H_MM;
  const lenX = Math.min(CUT_MARK_LENGTH_MM, m.x);
  const lenY = Math.min(CUT_MARK_LENGTH_MM, m.y);
  const out: Segment[] = [];
  for (let c = 0; c <= COLUMNS; c++) {
    const x = left + c * CARD_W_MM;
    out.push({ x1: x, y1: top - lenY, x2: x, y2: top });
    out.push({ x1: x, y1: bottom, x2: x, y2: bottom + lenY });
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = top + r * CARD_H_MM;
    out.push({ x1: left - lenX, y1: y, x2: left, y2: y });
    out.push({ x1: right, y1: y, x2: right + lenX, y2: y });
  }
  return out;
}

// ------------------------------------------------------------------ fetch queue

/**
 * Runs `worker` over `items` with at most `limit` running at once. Stops starting new
 * items after the first failure and rejects with it.
 */
export async function runQueue<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      signal?.throwIfAborted();
      const item = items[next++] as T;
      try {
        await worker(item);
      } catch (e) {
        if (!failed) {
          failed = true;
          firstError = e;
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  );
  if (failed) throw firstError;
}

export class ImageFetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ImageFetchError";
  }
}

const RETRIES = 2;

/** One image as bytes. Retries a network failure, a 429 and a 5xx. */
export async function fetchImage(
  slot: Slot,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let last: ImageFetchError | undefined;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetchFn(imagePath(slot), { signal: signal ?? null });
    } catch (e) {
      if (signal?.aborted === true) throw e;
      last = new ImageFetchError(
        `Could not load the ${slot.face} image of ${slot.id}: network error`,
        null,
      );
      continue;
    }
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    last = new ImageFetchError(
      `Could not load the ${slot.face} image of ${slot.id}: HTTP ${res.status}`,
      res.status,
    );
    if (res.status !== 429 && res.status < 500) break;
  }
  throw last as ImageFetchError;
}

/** Downloads each distinct image once, four at a time. */
export async function fetchAll(
  images: readonly Slot[],
  opts: Pick<BuildOptions, "fetch" | "signal" | "sleep" | "onProgress">,
): Promise<Map<string, Uint8Array>> {
  const fetchFn = opts.fetch ?? fetch;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bytes = new Map<string, Uint8Array>();
  let done = 0;
  opts.onProgress?.({ phase: "fetch", done, total: images.length });
  await runQueue(
    images,
    FETCH_CONCURRENCY,
    async (s) => {
      bytes.set(imageKey(s), await fetchImage(s, fetchFn, sleep, opts.signal));
      done++;
      opts.onProgress?.({ phase: "fetch", done, total: images.length });
    },
    opts.signal,
  );
  return bytes;
}

// ------------------------------------------------------------------------- build

const isPng = (b: Uint8Array): boolean => b[0] === 0x89 && b[1] === 0x50;

/**
 * The proxy PDF of a deck: each card `count` times, a double-faced card's back after
 * its front, nine to a page at 63×88 mm, centred. Rejects when an image cannot be
 * loaded.
 */
export async function buildProxyPdf(
  entries: readonly ProxyEntry[],
  options: BuildOptions,
): Promise<Uint8Array> {
  const slots = expandSlots(entries);
  const bytes = await fetchAll(uniqueImages(slots), options);

  options.onProgress?.({ phase: "build", done: 0, total: slots.length });
  const pdf = await PDFDocument.create();
  pdf.setTitle("Proxy cards");
  pdf.setCreator("tcg-gauntlet");
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // Each unique image is embedded once and drawn for every copy.
  const embedded = new Map<string, PDFImage>();
  for (const [key, data] of bytes)
    embedded.set(
      key,
      isPng(data) ? await pdf.embedPng(data) : await pdf.embedJpg(data),
    );

  const paper = PAPER_MM[options.paper];
  const pageW = mmToPt(paper.w);
  const pageH = mmToPt(paper.h);
  const black = rgb(0, 0, 0);

  for (let first = 0; first < slots.length; first += CARDS_PER_PAGE) {
    const page = pdf.addPage([pageW, pageH]);
    for (let i = 0; i < CARDS_PER_PAGE && first + i < slots.length; i++) {
      const slot = slots[first + i] as Slot;
      const img = embedded.get(imageKey(slot)) as PDFImage;
      const r = fitInSlot(slotRect(i, options.paper), img.width, img.height);
      page.drawImage(img, {
        x: mmToPt(r.x),
        y: pageH - mmToPt(r.y + r.h),
        width: mmToPt(r.w),
        height: mmToPt(r.h),
      });
    }
    if (options.cutLines)
      for (const s of cutMarks(options.paper))
        page.drawLine({
          start: { x: mmToPt(s.x1), y: pageH - mmToPt(s.y1) },
          end: { x: mmToPt(s.x2), y: pageH - mmToPt(s.y2) },
          thickness: mmToPt(CUT_LINE_MM),
          color: black,
        });
    if (options.marginNote) {
      const width = font.widthOfTextAtSize(MARGIN_NOTE, MARGIN_NOTE_SIZE_PT);
      // Centred in the bottom margin, on the page's middle line.
      const bottomMargin = mmToPt(margins(options.paper).y);
      page.drawText(MARGIN_NOTE, {
        x: (pageW - width) / 2,
        y: bottomMargin / 2 - MARGIN_NOTE_SIZE_PT * 0.35,
        size: MARGIN_NOTE_SIZE_PT,
        font,
        color: black,
      });
    }
    options.onProgress?.({
      phase: "build",
      done: Math.min(first + CARDS_PER_PAGE, slots.length),
      total: slots.length,
    });
  }
  return pdf.save();
}

/** Hands the PDF to the browser as a download. There is no preview. */
export function downloadPdf(data: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([data as BlobPart], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
