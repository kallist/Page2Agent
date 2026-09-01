/**
 * MV3 extension E2E 鈥?deterministic local harness (E2E-B).
 *
 * Loads dist-e2e/ (production build + test-only host_permissions for the
 * local fixture origin) in a persistent Chromium context and drives the full
 * product flow through the extension's own Side Panel page UI: capture
 * intent 鈫?service worker 鈫?content script extraction 鈫?storage 鈫?UI restore.
 *
 * The harness replaces the activeTab grant (GUI toolbar/side-panel automation
 * is not reliably possible) with a test-only host permission for the local
 * fixture origin; it therefore does NOT validate the production activeTab
 * grant UX or the native Side Panel container 鈥?those remain manual QA items.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { Server as HttpServer } from "node:http";

/** Minimal ambient typing for the extension runtime inside page.evaluate. */
declare const chrome: {
  runtime: {
    id: string;
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    session: {
      get(keys: string | null): Promise<Record<string, unknown>>;
    };
  };
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST_E2E = join(ROOT, "dist-e2e");
const FIXTURES = join(ROOT, "fixtures");
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

let server: HttpServer;
let context: BrowserContext;
let extensionId: string;
let panel: Page;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", BASE);
      const file = join(FIXTURES, decodeURIComponent(url.pathname));
      const data = await readFile(file);
      res.writeHead(200, { "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(PORT, "127.0.0.1", resolveListen));

  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST_E2E}`,
      `--load-extension=${DIST_E2E}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  expect(serviceWorker.url()).toContain("chrome-extension://");
  extensionId = new URL(serviceWorker.url()).host;

  // Driver: the extension's own side panel page (extension context UI).
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole("heading", { name: "Page2Agent" })).toBeVisible();
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
});

/** Open a fixture as the active tab (the worker captures the active tab). */
async function openFixture(path: string): Promise<Page> {
  const fixture = await context.newPage();
  await fixture.goto(`${BASE}${path}`);
  await fixture.bringToFront();
  return fixture;
}

async function sessionState(): Promise<Record<string, unknown>> {
  const [serviceWorker] = context.serviceWorkers();
  return serviceWorker.evaluate(() => chrome.storage.session.get(null));
}

/** Click the capture button regardless of the panel's current state. */
async function clickCapture(): Promise<void> {
  await panel.getByRole("button", { name: /Capture Current Page|Capture Again/ }).click();
}

test("extension service worker activates", async () => {
  const [serviceWorker] = context.serviceWorkers();
  expect(serviceWorker).toBeTruthy();
  const id = await serviceWorker.evaluate(() => chrome.runtime.id);
  expect(id).toBe(extensionId);
});

test("generic fixture capture completes end-to-end through the panel UI", async () => {
  const fixture = await openFixture("/generic/article-basic.html");

  await clickCapture();
  await expect(panel.getByRole("heading", { name: "Capturing Web Contexts for Coding Agents" })).toBeVisible();
  await expect(panel.getByText("Web Page", { exact: true })).toBeVisible();
  await expect(panel.getByText("Use as context", { exact: true })).toBeVisible();

  const session = await sessionState();
  const intent = session["page2agent.latest-capture.v1"] as { captureId: string } | undefined;
  expect(intent).toBeTruthy();
  const outcome = session[`page2agent.capture-result.v1.${intent?.captureId}`] as
    | { status: string; captureId: string; result?: { title: string; stats?: { characters: number } } }
    | undefined;
  expect(outcome?.status).toBe("captured");
  expect(outcome?.captureId).toBe(intent?.captureId);
  expect(outcome?.result?.title).toBe("Capturing Web Contexts for Coding Agents");
  expect((outcome?.result?.stats?.characters ?? 0)).toBeGreaterThan(100);

  await fixture.close();
});

test("repeated capture stays consistent with the latest intent", async () => {
  const fixture = await openFixture("/generic/article-basic.html");

  await clickCapture();
  await expect(panel.getByRole("heading", { name: "Capturing Web Contexts for Coding Agents" })).toBeVisible();

  // Capture Again (button stays enabled; latest capture wins).
  await clickCapture();
  await expect(panel.getByRole("heading", { name: "Capturing Web Contexts for Coding Agents" })).toBeVisible();

  const session = await sessionState();
  const intent = session["page2agent.latest-capture.v1"] as { captureId: string } | undefined;
  expect(intent).toBeTruthy();
  const outcome = session[`page2agent.capture-result.v1.${intent?.captureId}`] as
    | { status: string; captureId: string }
    | undefined;
  expect(outcome?.status).toBe("captured");
  expect(outcome?.captureId).toBe(intent?.captureId);

  // Outcome hygiene: each new capture cleans up old outcomes, so the session
  // stays bounded (never accumulates one key per capture).
  const outcomeKeys = Object.keys(session).filter((key) => key.startsWith("page2agent.capture-result.v1."));
  expect(outcomeKeys.length).toBeLessThanOrEqual(2);

  await fixture.close();
});

test("no-content fixture yields a friendly typed failure in the panel", async () => {
  const fixture = await openFixture("/generic/article-no-content.html");

  await panel.getByRole("button", { name: /Capture/ }).click();
  await expect(panel.getByText("Unable to find meaningful page content.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Capture Again" })).toBeVisible();

  const session = await sessionState();
  const intent = session["page2agent.latest-capture.v1"] as { captureId: string } | undefined;
  const outcome = session[`page2agent.capture-result.v1.${intent?.captureId}`] as
    | { status: string; error?: { code: string; message: string } }
    | undefined;
  expect(outcome?.status).toBe("error");
  expect(outcome?.error?.code).toBe("NO_CONTENT_FOUND");
  expect(outcome?.error?.message).not.toContain("Error");

  await fixture.close();
});

test("a freshly opened panel page restores the latest captured session", async () => {
  const fixture = await openFixture("/generic/article-basic.html");

  await clickCapture();
  await expect(panel.getByRole("heading", { name: "Capturing Web Contexts for Coding Agents" })).toBeVisible();

  const restored = await context.newPage();
  await restored.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(restored.getByRole("heading", { name: "Capturing Web Contexts for Coding Agents" })).toBeVisible();
  await expect(restored.getByText("Web Page", { exact: true })).toBeVisible();
  await expect(restored.getByText("Use as context", { exact: true })).toBeVisible();

  await fixture.close();
  await restored.close();
});


