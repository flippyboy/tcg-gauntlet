import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  CARD_H_MM,
  CARD_W_MM,
  type ProxyEntry,
  type Slot,
  buildProxyPdf,
  cutMarks,
  expandSlots,
  fetchAll,
  fetchImage,
  fitInSlot,
  margins,
  mmToPt,
  pageCount,
  runQueue,
  slotRect,
  uniqueImages,
} from "../src/lib/client/pdf.js";

const JPEG = readFileSync(new URL("../e2e/stub-card.jpg", import.meta.url));
const ID = (n: number): string =>
  `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const noSleep = (): Promise<void> => Promise.resolve();

const near = (a: number, b: number, d = 1e-9): void =>
  expect(Math.abs(a - b)).toBeLessThan(d);

describe("layout math", () => {
  it("margins on A4 are 10.5 mm at the sides and 16.5 mm top and bottom", () => {
    const m = margins("a4");
    near(m.x, 10.5);
    near(m.y, 16.5);
  });

  it("margins on Letter are 13.45 mm at the sides and 7.7 mm top and bottom", () => {
    const m = margins("letter");
    near(m.x, 13.45);
    near(m.y, 7.7);
  });

  it("puts nine 63x88 mm slots in a centred 189x264 mm grid", () => {
    for (const paper of ["a4", "letter"] as const) {
      const m = margins(paper);
      const first = slotRect(0, paper);
      const last = slotRect(8, paper);
      expect(first).toEqual({ x: m.x, y: m.y, w: 63, h: 88 });
      near(last.x, m.x + 2 * 63);
      near(last.y, m.y + 2 * 88);
      near(last.x + last.w + m.x, paper === "a4" ? 210 : 215.9);
      near(last.y + last.h + m.y, paper === "a4" ? 297 : 279.4);
    }
  });

  it("fills rows left to right, then top to bottom", () => {
    const s = (i: number) => slotRect(i, "a4");
    expect(s(1).x - s(0).x).toBe(63);
    expect(s(1).y).toBe(s(0).y);
    expect(s(3).x).toBe(s(0).x);
    expect(s(3).y - s(0).y).toBe(88);
  });

  it("counts pages", () => {
    expect([0, 1, 9, 10, 18, 19, 60].map(pageCount)).toEqual([
      0, 1, 1, 2, 2, 3, 7,
    ]);
  });

  it("keeps the aspect ratio of an image and centres it", () => {
    const slot = slotRect(4, "a4");
    // Exactly the card's ratio: fills the slot.
    expect(fitInSlot(slot, 672, 936).w).toBeLessThanOrEqual(CARD_W_MM);
    const wide = fitInSlot(slot, 200, 100);
    near(wide.w, CARD_W_MM);
    near(wide.h, CARD_W_MM / 2);
    near(wide.x, slot.x);
    near(wide.y, slot.y + (CARD_H_MM - CARD_W_MM / 2) / 2);
    const tall = fitInSlot(slot, 100, 400);
    near(tall.h, CARD_H_MM);
    near(tall.w, CARD_H_MM / 4);
    near(tall.x, slot.x + (CARD_W_MM - CARD_H_MM / 4) / 2);
    expect(tall.w / tall.h).toBeCloseTo(0.25, 9);
  });

  it("draws cut marks only in the margin, on the card edges", () => {
    for (const paper of ["a4", "letter"] as const) {
      const m = margins(paper);
      const marks = cutMarks(paper);
      // 4 vertical edges and 4 horizontal edges, two marks each.
      expect(marks).toHaveLength(16);
      const gx0 = m.x;
      const gx1 = m.x + 189;
      const gy0 = m.y;
      const gy1 = m.y + 264;
      for (const s of marks) {
        const vertical = s.x1 === s.x2;
        if (vertical) {
          expect([0, 1, 2, 3].map((c) => gx0 + c * 63)).toContain(s.x1);
          const lo = Math.min(s.y1, s.y2);
          const hi = Math.max(s.y1, s.y2);
          expect(hi - lo).toBeGreaterThan(0);
          // Entirely above or below the grid.
          expect(hi <= gy0 + 1e-9 || lo >= gy1 - 1e-9).toBe(true);
          expect(lo).toBeGreaterThanOrEqual(0);
          expect(hi).toBeLessThanOrEqual(paper === "a4" ? 297 : 279.4);
        } else {
          expect([0, 1, 2, 3].map((r) => gy0 + r * 88)).toContain(s.y1);
          const lo = Math.min(s.x1, s.x2);
          const hi = Math.max(s.x1, s.x2);
          expect(hi <= gx0 + 1e-9 || lo >= gx1 - 1e-9).toBe(true);
          expect(lo).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("converts millimetres to points", () => {
    near(mmToPt(25.4), 72);
  });
});

describe("slots and de-duplication", () => {
  const entries: ProxyEntry[] = [
    { scryfallId: ID(1), count: 4, hasBackFace: false },
    { scryfallId: ID(2), count: 2, hasBackFace: true },
    { scryfallId: ID(3), count: 1, hasBackFace: false },
  ];

  it("repeats each card count times and adds the back faces", () => {
    const slots = expandSlots(entries);
    expect(slots).toHaveLength(4 + 2 + 2 + 1);
    expect(slots.filter((s) => s.face === "back")).toHaveLength(2);
    expect(
      slots.slice(4, 8).map((s) => `${s.id.slice(0, 1)}${s.face}`),
    ).toEqual(["0front", "0front", "0back", "0back"]);
  });

  it("lists each distinct image once, in first-use order", () => {
    const u = uniqueImages(expandSlots(entries));
    expect(u.map((s) => `${s.id.slice(0, 8)}/${s.face}`)).toEqual([
      "00000001/front",
      "00000002/front",
      "00000002/back",
      "00000003/front",
    ]);
  });
});

describe("fetch queue", () => {
  it("never runs more than 4 at once and runs everything", async () => {
    let active = 0;
    let peak = 0;
    const ran: number[] = [];
    await runQueue(
      Array.from({ length: 25 }, (_, i) => i),
      4,
      async (i) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        ran.push(i);
        active--;
      },
    );
    expect(peak).toBe(4);
    expect(ran).toHaveLength(25);
  });

  it("stops starting items after a failure and rejects with the first error", async () => {
    const started: number[] = [];
    await expect(
      runQueue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, async (i) => {
        started.push(i);
        await new Promise((r) => setTimeout(r, 1));
        if (i === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(started.length).toBeLessThan(10);
  });

  it("fetches each unique image once, 4 at a time, with progress", async () => {
    const slots: Slot[] = Array.from({ length: 12 }, (_, i) => ({
      id: ID(i),
      face: "front" as const,
    }));
    const seen: string[] = [];
    let active = 0;
    let peak = 0;
    const stub = (async (url: string) => {
      seen.push(url);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return new Response(new Uint8Array(JPEG));
    }) as unknown as typeof fetch;
    const progress: number[] = [];
    const bytes = await fetchAll(uniqueImages([...slots, ...slots]), {
      fetch: stub,
      sleep: noSleep,
      onProgress: (p) => progress.push(p.done),
    });
    expect(bytes.size).toBe(12);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen[0]).toBe(`/img/${ID(0)}/front`);
    expect(peak).toBe(4);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(12);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("retries a 503 and a thrown error, then gives up with a clear message", async () => {
    const slot: Slot = { id: ID(1), face: "back" };
    let calls = 0;
    const flaky = (() => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError("offline"));
      if (calls === 2)
        return Promise.resolve(new Response("x", { status: 503 }));
      return Promise.resolve(new Response(new Uint8Array(JPEG)));
    }) as unknown as typeof fetch;
    const out = await fetchImage(slot, flaky, noSleep);
    expect(out.length).toBe(JPEG.length);
    expect(calls).toBe(3);

    let calls404 = 0;
    const gone = (() => {
      calls404++;
      return Promise.resolve(new Response("no", { status: 404 }));
    }) as unknown as typeof fetch;
    await expect(fetchImage(slot, gone, noSleep)).rejects.toThrow(/HTTP 404/);
    expect(calls404).toBe(1);

    const down = (() =>
      Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
    await expect(fetchImage(slot, down, noSleep)).rejects.toThrow(
      /network error/,
    );
  });
});

describe("buildProxyPdf", () => {
  const stub = (urls: string[]): typeof fetch =>
    ((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(new Uint8Array(JPEG)));
    }) as unknown as typeof fetch;

  async function imageObjects(bytes: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(bytes);
    let n = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects())
      if (
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      )
        n++;
    return n;
  }

  it("makes 60 cards into 7 pages, embeds each image once, and sizes pages", async () => {
    const entries: ProxyEntry[] = [
      { scryfallId: ID(1), count: 4, hasBackFace: false },
      { scryfallId: ID(2), count: 4, hasBackFace: false },
      ...Array.from({ length: 52 }, (_, i) => ({
        scryfallId: ID(10 + i),
        count: 1,
        hasBackFace: false,
      })),
    ];
    const urls: string[] = [];
    const phases: string[] = [];
    const bytes = await buildProxyPdf(entries, {
      paper: "a4",
      cutLines: true,
      marginNote: true,
      fetch: stub(urls),
      sleep: noSleep,
      onProgress: (p) => phases.push(p.phase),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(7);
    const { width, height } = doc.getPage(0).getSize();
    near(width, mmToPt(210), 1e-6);
    near(height, mmToPt(297), 1e-6);
    // 54 distinct images, fetched once each, embedded once each.
    expect(urls).toHaveLength(54);
    expect(await imageObjects(bytes)).toBe(54);
    expect(phases[0]).toBe("fetch");
    expect(phases.at(-1)).toBe("build");
  });

  it("uses Letter paper, adds back faces and can leave out marks and note", async () => {
    const urls: string[] = [];
    const entries: ProxyEntry[] = [
      { scryfallId: ID(1), count: 5, hasBackFace: true },
    ];
    const plain = await buildProxyPdf(entries, {
      paper: "letter",
      cutLines: false,
      marginNote: false,
      fetch: stub(urls),
      sleep: noSleep,
    });
    const full = await buildProxyPdf(entries, {
      paper: "letter",
      cutLines: true,
      marginNote: true,
      fetch: stub([]),
      sleep: noSleep,
    });
    const doc = await PDFDocument.load(plain);
    expect(doc.getPageCount()).toBe(2); // 5 fronts + 5 backs = 10 cards
    near(doc.getPage(0).getSize().width, mmToPt(215.9), 1e-6);
    expect(urls.sort()).toEqual([`/img/${ID(1)}/back`, `/img/${ID(1)}/front`]);
    expect(await imageObjects(plain)).toBe(2);
    // The marks and the note add drawing operators, so the file is larger.
    expect(full.length).toBeGreaterThan(plain.length);
  });

  it("rejects with the failing card when an image cannot be loaded", async () => {
    const missing = (() =>
      Promise.resolve(
        new Response("no", { status: 404 }),
      )) as unknown as typeof fetch;
    await expect(
      buildProxyPdf([{ scryfallId: ID(1), count: 1, hasBackFace: false }], {
        paper: "a4",
        cutLines: false,
        marginNote: false,
        fetch: missing,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/front image of 00000001/);
  });

  it("makes a valid, empty file for no cards", async () => {
    const bytes = await buildProxyPdf([], {
      paper: "a4",
      cutLines: true,
      marginNote: true,
      fetch: stub([]),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
