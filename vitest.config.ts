import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e is Playwright territory (MV3 extension E2E).
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});
