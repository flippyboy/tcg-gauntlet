import { defineConfig, devices } from "@playwright/test";

// The smoke suite of item 73. `e2e/run.ts` starts the app and sets E2E_BASE_URL,
// E2E_REPO_DIR and E2E_WEBHOOK_SECRET; CI sets them for the Docker image.
// E2E_CHROMIUM_PATH points at a Chromium or Chrome binary when Playwright's own
// download is not installed.
const executablePath = process.env["E2E_CHROMIUM_PATH"];

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // The poll test waits for the default 30 s poll interval, and the cold start
  // downloads the mini card data and builds the history.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // The tests share one app and one deck repo, and add commits to it, in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:3000",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath === undefined
          ? {}
          : { launchOptions: { executablePath } }),
      },
    },
  ],
});
