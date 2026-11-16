// The end-to-end smoke test of item 73. It runs against an app that serves the deck
// repo in E2E_REPO_DIR (see run.ts). Tests tagged @browser need Chromium; the rest use
// only Playwright's request context. The tests run in order and share the app: the two
// freshness tests add commits to the deck repo.
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const repoDir = process.env["E2E_REPO_DIR"] ?? "";
const secret = process.env["E2E_WEBHOOK_SECRET"] ?? "";
const expectedMtgo = readFileSync(
  new URL("./expected/burn.mtgo.txt", import.meta.url),
);

/** Adds a commit to the fixture deck repo and returns its SHA. */
function commitDeck(file: string, body: string): string {
  writeFileSync(join(repoDir, file), body);
  const env = {
    PATH: process.env["PATH"] ?? "",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "E2E Author",
    GIT_AUTHOR_EMAIL: "e2e@example.com",
    GIT_COMMITTER_NAME: "E2E Author",
    GIT_COMMITTER_EMAIL: "e2e@example.com",
  };
  const run = (...a: string[]): string =>
    execFileSync("git", a, { cwd: repoDir, env, encoding: "utf8" }).trim();
  run("add", "-A");
  run("commit", "-q", "--no-gpg-sign", "-m", `Add ${file}`);
  return run("rev-parse", "HEAD");
}

const signed = (body: string): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(repoDir, "E2E_REPO_DIR").not.toBe("");
});

test("/readyz becomes 200", async ({ request }) => {
  await expect
    .poll(async () => (await request.get("/readyz")).status(), {
      timeout: 100_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(200);
  expect((await request.get("/healthz")).ok()).toBe(true);
});

test("the gauntlet list shows the fixture gauntlets", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("Modern Burn");
  expect(html).toContain("Modern Jund");
  expect(html).toContain('href="/g/modern-burn"');
  expect(res.headers()["content-security-policy"]).toContain(
    "img-src 'self' https://cards.scryfall.io",
  );
  // The footer shows the commit, the MTGJSON version and the engine version.
  expect(html).toContain("MTGJSON");
  expect(html).toContain("Engine");
});

test("a deck page shows grouped cards and the primer (no JavaScript needed)", async ({
  request,
}) => {
  const res = await request.get("/g/modern-burn/burn");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("Creature");
  expect(html).toContain("Instant");
  expect(html).toContain("Goblin Guide");
  expect(html).toContain("Burn primer");
  expect(html).toContain("Rest in Peace");
  // Markdown HTML is escaped, never run.
  expect(html).not.toContain('<script>alert("not rendered")</script>');
  expect(html).toContain("checked with MTGJSON");
  expect(html).toContain("Legal");
});

test("the MTGO export matches its fixture byte for byte", async ({
  request,
}) => {
  const res = await request.get("/g/modern-burn/burn/export/mtgo");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  expect((await res.body()).equals(expectedMtgo)).toBe(true);
  expect((await request.get("/g/modern-burn/burn/export/nope")).status()).toBe(
    404,
  );
});

test("the image route answers 404 for an id outside the snapshot", async ({
  request,
}) => {
  const res = await request.get(
    "/img/00000000-0000-4000-8000-000000000000/front",
  );
  expect(res.status()).toBe(404);
});

test("a bad webhook signature is rejected", async ({ request }) => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  const res = await request.post("/webhook/github", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-hub-signature-256": "sha256=" + "0".repeat(64),
    },
  });
  expect(res.status()).toBe(401);
});

test("a commit to the deck repo appears within 45 s (poll)", async ({
  request,
}) => {
  const started = Date.now();
  commitDeck("modern-burn/pollcommit.txt", "4 Lightning Bolt\n");
  await expect
    .poll(
      async () =>
        (await (await request.get("/g/modern-burn")).text()).includes(
          'href="/g/modern-burn/pollcommit"',
        ),
      { timeout: 45_000, intervals: [1000] },
    )
    .toBe(true);
  expect(Date.now() - started).toBeLessThan(45_000);
});

test("a signed webhook makes a new commit appear within 10 s", async ({
  request,
}) => {
  const sha = commitDeck("modern-burn/hookcommit.txt", "4 Lightning Bolt\n");
  const started = Date.now();
  const body = JSON.stringify({
    ref: "refs/heads/main",
    after: sha,
    repository: { full_name: "example/deck-repo" },
  });
  const res = await request.post("/webhook/github", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-hub-signature-256": signed(body),
    },
  });
  expect(res.status()).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get("/g/modern-burn")).text()).includes(
          'href="/g/modern-burn/hookcommit"',
        ),
      { timeout: 10_000, intervals: [500] },
    )
    .toBe(true);
  expect(Date.now() - started).toBeLessThan(10_000);
});

test("@browser the card preview shows the normal image on hover and tap", async ({
  page,
}) => {
  await page.goto("/g/modern-burn/burn");
  const name = page.getByRole("button", { name: "Lightning Bolt" }).first();
  const image = page
    .getByRole("img", { name: "Card image of Lightning Bolt" })
    .first();
  await expect(name).toBeVisible();
  await expect(image).toBeHidden();
  await name.hover();
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src).toMatch(
    /^https:\/\/cards\.scryfall\.io\/normal\/front\/[0-9a-f]\/[0-9a-f]\/[0-9a-f-]{36}\.jpg$/,
  );
  await expect(image).toHaveAttribute("loading", "lazy");
  await page.mouse.move(0, 0);
  await expect(image).toBeHidden();
  // A click (a tap) pins it, Escape closes it.
  await name.click();
  await expect(image).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(image).toBeHidden();
  // The export menu opens and lists the formats.
  await page.getByText("Export", { exact: true }).click();
  await expect(page.getByRole("link", { name: /MTGO/ })).toBeVisible();
});

test("@browser the proxies page builds a PDF with the expected page count", async ({
  page,
}) => {
  await page.goto("/g/modern-burn/burn/proxies");
  // 60 main deck and 15 sideboard cards, nine to a page.
  await expect(page.getByTestId("card-total")).toHaveText("75");
  await expect(page.getByTestId("page-total")).toHaveText("9");
  const button = page.getByRole("button", { name: "Download PDF" });
  await expect(button).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    button.click(),
  ]);
  expect(download.suggestedFilename()).toBe("burn-proxies.pdf");
  const path = await download.path();
  const a4 = await PDFDocument.load(readFileSync(path));
  expect(a4.getPageCount()).toBe(9);
  expect(a4.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  expect(a4.getPage(0).getHeight()).toBeCloseTo(841.89, 0);
  await expect(page.getByTestId("pdf-done")).toContainText(
    "75 cards on 9 pages",
  );

  // US Letter, without cut lines and without the note.
  await page.getByLabel("Paper").selectOption("letter");
  await page.getByLabel("Cut lines in the margin").uncheck();
  await page.getByLabel(/note in the bottom margin/).uncheck();
  const [second] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    button.click(),
  ]);
  const letter = await PDFDocument.load(readFileSync(await second.path()));
  expect(letter.getPageCount()).toBe(9);
  expect(letter.getPage(0).getWidth()).toBeCloseTo(612, 0);
  expect(letter.getPage(0).getHeight()).toBeCloseTo(792, 0);
});
