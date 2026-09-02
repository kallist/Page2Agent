import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import type { PageContext } from "../../src/core";

/** Base URL used for relative URL resolution in fixture tests. */
export const FIXTURE_BASE_URL = "https://example.com/docs/page";

/** CapturedAt used for determinism assertions (§101). */
export const FIXTURE_CAPTURED_AT = "2026-08-31T00:00:00.000Z";

/**
 * Fixtures live at <repo root>/fixtures/generic and fixtures/github.
 * process.cwd() is the npm script working directory (repo root);
 * import.meta.url is NOT usable here because in the jsdom test environment it
 * is a Vite dev-server URL.
 */
const GENERIC_FIXTURES_DIR = resolve("fixtures", "generic");
const GITHUB_FIXTURES_DIR = resolve("fixtures", "github");

/**
 * Load a synthetic HTML fixture with jsdom. Scripts are never executed and
 * no external resources are fetched — fixtures are offline and deterministic.
 */
export function loadFixture(fileName: string, url: string = FIXTURE_BASE_URL): Document {
  const html = readFileSync(resolve(GENERIC_FIXTURES_DIR, fileName), "utf8");
  return new JSDOM(html, { url }).window.document;
}

/** GitHub Issue fixture base URL (identity used in fixtures and tests). */
export const GITHUB_FIXTURE_BASE_URL = "https://github.com/acme/page2agent-demo/issues/123";

export function loadGitHubFixture(
  fileName: string,
  url: string = GITHUB_FIXTURE_BASE_URL,
): Document {
  const html = readFileSync(resolve(GITHUB_FIXTURES_DIR, fileName), "utf8");
  return new JSDOM(html, { url }).window.document;
}

/** Parse arbitrary HTML into a jsdom document (no script execution, no fetches). */
export function loadHtml(html: string, url: string = FIXTURE_BASE_URL): Document {
  return new JSDOM(html, { url }).window.document;
}

export function makePageContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    captureId: "11111111-1111-4111-8111-111111111111",
    tabId: 7,
    url: FIXTURE_BASE_URL,
    title: "Fixture page",
    capturedAt: FIXTURE_CAPTURED_AT,
    ...overrides,
  };
}
