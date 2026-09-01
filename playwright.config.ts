import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // MV3 extension automation uses one persistent context: single worker.
  workers: 1,
  fullyParallel: false,
  retries: 0, // never hide deterministic failures
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
