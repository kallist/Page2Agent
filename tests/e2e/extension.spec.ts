/**
 * MV3 extension E2E — V1.1 Visual Context Workbench (deterministic local
 * harness).
 *
 * Loads dist-e2e/ (production build + test-only host_permissions for the
 * local fixture origin) in a persistent Chromium context and drives the full
 * workbench flows: capture → workbench → Context Lens → Context Cart →
 * Recipes → TaskSpec/Agent output → Context Receipt.
 *
 * The harness replaces the activeTab grant (GUI toolbar/side-panel automation
 * is not reliably possible) with a test-only host permission for the local
 * fixture origin; it therefore does NOT validate the production activeTab
 * grant UX, the native Side Panel container, or real github.com rendering —
 * those remain manual QA / integration-test territory.
 *
 * Known harness limitation: capture identity comes from the tab URL, so the
 * GitHub Issue/PR adapters cannot be exercised against fixture pages
 * (github.com is out of harness scope by design). Issue/PR adapter fidelity
 * is covered by jsdom unit/integration suites; the fix_issue TaskSpec kind
 * is verified there too. E2E C verifies recipe selection → TaskSpec mapping
 * on a generic capture (kind "fix").
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
  tabs: {
    query(queryInfo: { active: boolean; lastFocusedWindow: boolean }): Promise<
      Array<{ id?: number; windowId: number; url?: string; title?: string }>
    >;
  };
  storage: {
    session: {
      get(keys: string | null): Promise<Record<string, unknown>>;
      clear(): Promise<void>;
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
      res.writeHead(200, {
        "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(PORT, "127.0.0.1", resolveListen));

  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${DIST_E2E}`, `--load-extension=${DIST_E2E}`],
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

/** Reset session + panel so every scenario starts from a clean workbench. */
async function clearSession(): Promise<void> {
  await panel.evaluate(() => chrome.storage.session.clear());
  await panel.reload();
  await expect(panel.getByText("No page captured yet")).toBeVisible();
}

/** Open a fixture as the active tab (the worker captures the active tab). */
async function openFixture(path: string): Promise<Page> {
  const fixture = await context.newPage();
  await fixture.goto(`${BASE}${path}`);
  await fixture.bringToFront();
  return fixture;
}

/**
 * Emulate chrome.action.onClicked with the exact active tab. This message is
 * accepted only by dist-e2e/ because its manifest has the localhost-only host
 * permission; production dist/ rejects the seam.
 */
async function triggerHarnessAction(): Promise<void> {
  const response = await panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || tab.url === undefined) {
      throw new Error("The E2E active fixture tab could not be resolved.");
    }
    return chrome.runtime.sendMessage({
      type: "harness.capture.request",
      tab: {
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        ...(tab.title === undefined ? {} : { title: tab.title }),
      },
    });
  });
  expect(response).toMatchObject({ type: expect.stringMatching(/^capture\./) });
}

async function waitForCapturedTitle(title: string): Promise<void> {
  await expect(panel.getByRole("heading", { name: title })).toBeVisible();
  await expect(panel.getByRole("button", { name: "+ Add to Context" })).toBeVisible();
}

async function waitForAgentReady(): Promise<void> {
  await expect(panel.getByText(/# Page2Agent Task/)).toBeVisible();
}

async function openTaskSpecTab(): Promise<void> {
  await panel.getByRole("tab", { name: "TaskSpec" }).click();
  await expect(panel.getByRole("tabpanel", { name: "TaskSpec preview" })).toBeVisible();
}

async function taskSpecText(): Promise<string> {
  const text = await panel.getByRole("tabpanel", { name: "TaskSpec preview" }).locator("pre").innerText();
  return text;
}

test("extension service worker activates", async () => {
  const [serviceWorker] = context.serviceWorkers();
  expect(serviceWorker).toBeTruthy();
  const id = await serviceWorker.evaluate(() => chrome.runtime.id);
  expect(id).toBe(extensionId);
});

test("generic fixture capture completes end-to-end through the workbench UI", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-basic.html");

  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");
  await expect(panel.getByText("Web Page", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Pick Context" })).toBeVisible();
  await waitForAgentReady();

  const session = await panel.evaluate(() => chrome.storage.session.get(null));
  const intentKey = Object.keys(session).find((key) => key.startsWith("page2agent.latest-capture.v1."));
  expect(intentKey).toBeTruthy();
  const intent = intentKey === undefined ? undefined : (session[intentKey] as { captureId: string });
  const outcome = session[`page2agent.capture-result.v1.${intent?.captureId}`] as
    | { status: string; result?: { title: string; stats?: { characters: number } } }
    | undefined;
  expect(outcome?.status).toBe("captured");
  expect(outcome?.result?.title).toBe("Capturing Web Contexts for Coding Agents");
  expect((outcome?.result?.stats?.characters ?? 0)).toBeGreaterThan(100);

  await fixture.close();
});

test("E2E A — Context Lens picks one section; agent output only carries it", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-basic.html");
  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");

  // Enter lens mode from the panel.
  await panel.getByRole("button", { name: "Pick Context" }).click();
  await expect(panel.getByText(/Context Lens is on the page/)).toBeVisible();

  // Click the "Why structure matters" section heading on the page: the lens
  // selects the heading-anchored section (heading + paragraph + quote).
  await fixture.getByRole("heading", { name: "Why structure matters" }).click();
  await expect(fixture.getByText(/1 area selected/)).toBeVisible();
  await fixture.getByRole("button", { name: "Done" }).click();

  // Panel now offers to add the picked section as one Context source.
  await expect(panel.getByText(/Use the picked area as a Context source/)).toBeVisible();
  await panel.getByRole("button", { name: "Add to Context" }).click();
  await expect(panel.getByText("Added 1 picked area(s) to Context.")).toBeVisible();

  // Agent output contains ONLY the picked section.
  await waitForAgentReady();
  const agentText = await panel.getByRole("tabpanel", { name: "Agent preview" }).locator("pre").innerText();
  expect(agentText).toContain("Why structure matters");
  expect(agentText).toContain("architecture docs");
  expect(agentText).not.toContain("When an agent works on an issue");
  expect(agentText).not.toContain("Capture, extract, normalize");

  await fixture.close();
});

test("E2E B — Context Cart combines two pages and Compare builds a 2-source task", async () => {
  await clearSession();
  const fixtureA = await openFixture("/generic/article-basic.html");
  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");
  await panel.getByRole("button", { name: "+ Add to Context" }).click();
  await expect(panel.getByText("Added to Context.")).toBeVisible();

  const fixtureB = await openFixture("/generic/article-metadata.html");
  await triggerHarnessAction();
  await expect(panel.getByRole("button", { name: "+ Add to Context" })).toBeVisible();
  await panel.getByRole("button", { name: "+ Add to Context" }).click();
  await expect(panel.getByText("Added to Context.")).toBeVisible();

  // Cart shows two sources; Compare becomes available.
  const cartSection = panel.getByLabel("Context Cart");
  await expect(cartSection.getByText("2")).toBeVisible();
  const compare = panel.getByRole("radio", { name: /Compare/ });
  await expect(compare).toBeEnabled();
  await compare.click();

  await openTaskSpecTab();
  const json = await taskSpecText();
  expect(json).toContain('"recipe": "compare"');
  expect(json).toContain('"task": {');
  expect(json).toContain('"kind": "compare"');
  expect(json).toContain('"sources": [');
  // Compare must refuse to fabricate a target repository from two web pages.
  expect(json).toContain('"repository": null');

  await fixtureA.close();
  await fixtureB.close();
});

test("E2E C — Recipe selection drives TaskSpec kind (Fix on generic capture)", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-basic.html");
  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");

  await panel.getByRole("radio", { name: /Fix/ }).click();
  await waitForAgentReady();
  const agentText = await panel.getByRole("tabpanel", { name: "Agent preview" }).locator("pre").innerText();
  expect(agentText).toContain("Recipe: Fix");
  expect(agentText).toContain("Task kind: fix");

  await openTaskSpecTab();
  const json = await taskSpecText();
  expect(json).toContain('"recipe": "fix"');
  expect(json).toContain('"kind": "fix"');

  await fixture.close();
});

test("E2E D — Technical Documentation is classified and Build is recommended", async () => {
  await clearSession();
  const fixture = await openFixture("/docs/api-reference.html");
  await triggerHarnessAction();

  await expect(panel.getByRole("heading", { name: "Streaming API Reference" })).toBeVisible();
  await expect(panel.getByText("Technical Documentation", { exact: true })).toBeVisible();

  await openTaskSpecTab();
  const json = await taskSpecText();
  expect(json).toContain('"recipe": "build"');
  expect(json).toContain('"id": "technical-docs"');
  expect(json).toContain('"kind": "build"');

  await fixture.close();
});

test("E2E E — Context Receipt shows observable Included/Excluded facts", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-basic.html");
  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");

  const receipt = panel.getByLabel("Context Receipt");
  await receipt.scrollIntoViewIfNeeded();
  await expect(receipt.getByText("Included")).toBeVisible();
  await expect(receipt.getByText("Excluded")).toBeVisible();
  await expect(receipt.getByText("Generated")).toBeVisible();
  await expect(receipt.getByText("Context facts")).toBeVisible();
  await expect(receipt.getByText("Clean")).toBeVisible();

  await fixture.close();
});

test("no-content fixture yields a friendly typed failure in the panel", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-no-content.html");

  await triggerHarnessAction();
  await expect(panel.getByText("Unable to find meaningful page content.")).toBeVisible();
  await expect(panel.getByText(/toolbar icon to try again/)).toBeVisible();

  const session = await panel.evaluate(() => chrome.storage.session.get(null));
  const intentKey = Object.keys(session).find((key) => key.startsWith("page2agent.latest-capture.v1."));
  const intent = intentKey === undefined ? undefined : (session[intentKey] as { captureId: string });
  const outcome = session[`page2agent.capture-result.v1.${intent?.captureId}`] as
    | { status: string; error?: { code: string; message: string } }
    | undefined;
  expect(outcome?.status).toBe("error");
  expect(outcome?.error?.code).toBe("NO_CONTENT_FOUND");
  expect(outcome?.error?.message).not.toContain("Error");

  await fixture.close();
});

test("a freshly opened panel page restores the latest captured session", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-basic.html");

  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");

  const restored = await context.newPage();
  await restored.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(restored.getByRole("heading", { name: "Capturing Web Contexts for Coding Agents" })).toBeVisible();
  await expect(restored.getByText("Web Page", { exact: true })).toBeVisible();
  await expect(restored.getByRole("button", { name: "Pick Context" })).toBeVisible();

  await fixture.close();
  await restored.close();
});

test("repeated capture stays consistent with the latest intent", async () => {
  await clearSession();
  const fixture = await openFixture("/generic/article-basic.html");

  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");

  // A second action creates a fresh intent; latest capture wins.
  await triggerHarnessAction();
  await waitForCapturedTitle("Capturing Web Contexts for Coding Agents");

  const session = await panel.evaluate(() => chrome.storage.session.get(null));
  const outcomeKeys = Object.keys(session).filter((key) => key.startsWith("page2agent.capture-result.v1."));
  expect(outcomeKeys.length).toBeLessThanOrEqual(2);

  await fixture.close();
});
