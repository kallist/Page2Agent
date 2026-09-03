// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../../../src/extension/sidepanel/App";
import type { CaptureSessionDeps } from "../../../../src/extension/sidepanel/capture-session";
import { isContextCart } from "../../../../src/core";
import type { SessionStorage } from "../../../../src/extension/session/session-storage";
import { makeWebDocument } from "../../../helpers/workbench-fixtures";
import type { PanelLensClient } from "../../../../src/extension/sidepanel/workbench/lens-client";
import type { WorkbenchDeps } from "../../../../src/extension/sidepanel/use-workbench";
import type { CaptureResult } from "../../../../src/extension/capture/capture-result";
import { windowDocumentKey } from "../../../../src/extension/session/document-cache";
import { workbenchCartKey } from "../../../../src/extension/sidepanel/workbench/cart-session";

const SESSION_DEPS: CaptureSessionDeps = {
  readIntent: async () => null,
  readOutcome: async () => null,
  subscribeSessionChanges: () => () => undefined,
  now: () => "2026-09-01T00:00:00.000Z",
};

const RESULT: CaptureResult = {
  schemaVersion: 1,
  captureId: "capture-11111111-1111-4111-8111-111111111111",
  tabId: 7,
  url: "https://example.com/article",
  capturedAt: "2026-09-01T00:00:00.000Z",
  sourceKind: "web",
  title: "Example Article",
  actionKind: "use_as_context",
  stats: { characters: 123, codeBlocks: 1, links: 0 },
  markdown: "",
  agentContext: "",
  filename: "example-article.md",
};

function makeStorage(): SessionStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key) {
      return data[key];
    },
    async set(key, value) {
      data[key] = value;
    },
    async remove(key) {
      delete data[key];
    },
  };
}

function makeLens(overrides: Partial<PanelLensClient> = {}): PanelLensClient {
  const fail = async (): Promise<never> => {
    throw new Error("not implemented");
  };
  return {
    enter: fail,
    materialize: fail,
    clear: fail,
    probeSelection: async () => ({
      type: "lens.selection.probe.response",
      captureId: RESULT.captureId,
      ok: true,
      hasSelection: false,
    }),
    captureSelection: fail,
    ...overrides,
  };
}

function capturedSession(): CaptureSessionDeps {
  return {
    ...SESSION_DEPS,
    readIntent: async () => ({
      schemaVersion: 1,
      captureId: RESULT.captureId,
      startedAt: "2026-09-01T00:00:00.000Z",
    }),
    readOutcome: async () => ({
      schemaVersion: 1,
      status: "captured",
      captureId: RESULT.captureId,
      result: RESULT,
    }),
  };
}

function seedCapturedPage(storage: SessionStorage & { data: Record<string, unknown> }): void {
  storage.data[windowDocumentKey(5)] = {
    schemaVersion: 1,
    captureId: RESULT.captureId,
    document: makeWebDocument(),
  };
}

function renderApp({
  storage,
  session = SESSION_DEPS,
  lens,
}: {
  storage: SessionStorage;
  session?: CaptureSessionDeps;
  lens?: PanelLensClient;
}) {
  const workbench: WorkbenchDeps = {
    storage,
    windowId: async () => 5,
    lens: lens ?? makeLens(),
    subscribeMessages: () => () => undefined,
  };
  return render(<App deps={session} workbench={workbench} />);
}

describe("Page2Agent V1.1 side panel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the empty state before any capture", () => {
    renderApp({ storage: makeStorage() });
    expect(screen.getByText("No page captured yet")).toBeTruthy();
  });

  it("shows the captured source card, recommendations and workbench output", async () => {
    const storage = makeStorage();
    seedCapturedPage(storage);
    renderApp({ storage, session: capturedSession() });

    expect(await screen.findByText("Example Article")).toBeTruthy();
    expect(screen.getByText("Web Page")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("# Page2Agent Task", { exact: false })).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "TaskSpec" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Learn/ })).toBeTruthy();
  });

  it("adds the captured page to the Context Cart and persists it", async () => {
    const storage = makeStorage();
    seedCapturedPage(storage);
    renderApp({ storage, session: capturedSession() });

    const addButton = await screen.findByRole("button", { name: "+ Add to Context" });
    await userEvent.click(addButton);
    await waitFor(() => {
      expect(screen.getByText("Added to Context.")).toBeTruthy();
    });
    await waitFor(() => {
      const stored = storage.data[workbenchCartKey(5)];
      expect(isContextCart(stored)).toBe(true);
    });
    const cartSection = screen.getByLabelText("Context Cart");
    expect(within(cartSection).getByText("Example Article")).toBeTruthy();
  });

  it("starts Context Lens picking through the lens client", async () => {
    const storage = makeStorage();
    seedCapturedPage(storage);
    const lens = makeLens({
      enter: async () => ({
        type: "lens.enter.response",
        captureId: RESULT.captureId,
        ok: true,
        snapshot: { active: true, selectedCount: 0, estimatedTokens: 0 },
      }),
    });
    renderApp({ storage, session: capturedSession(), lens });

    const pickButton = await screen.findByRole("button", { name: "Pick Context" });
    await userEvent.click(pickButton);
    await waitFor(() => {
      expect(screen.getByText(/Context Lens is on the page/)).toBeTruthy();
    });
  });

  it("disables Compare without two sources and shows the hint", async () => {
    const storage = makeStorage();
    seedCapturedPage(storage);
    renderApp({ storage, session: capturedSession() });

    const compare = (await screen.findByRole("radio", { name: /Compare/ })) as HTMLButtonElement;
    expect(compare.disabled).toBe(true);
    expect(screen.getByText(/Compare needs at least two sources/)).toBeTruthy();
  });

  it("renders the Context Receipt with observable facts", async () => {
    const storage = makeStorage();
    seedCapturedPage(storage);
    renderApp({ storage, session: capturedSession() });

    const heading = await screen.findByText("Context Receipt");
    const receipt = heading.closest("section");
    expect(receipt).not.toBeNull();
    expect(within(receipt!).getByText("Included")).toBeTruthy();
    expect(within(receipt!).getByText("Excluded")).toBeTruthy();
    expect(within(receipt!).getAllByText(/estimated tokens/).length).toBeGreaterThan(0);
    expect(within(receipt!).getByText("Context facts")).toBeTruthy();
  });

  it("keeps rendering cleanly when the chosen recipe becomes gated after clearing the cart", async () => {
    const storage = makeStorage();
    seedCapturedPage(storage);
    // Pre-seed a two-source cart so Compare can be chosen first.
    const { addContextSource, createEmptyCart } = await import("../../../../src/core");
    const { makeWebDocument } = await import("../../../helpers/workbench-fixtures");
    const docA = makeWebDocument({
      source: { kind: "web", url: "https://example.com/a", site: "example.com" },
      metadata: { title: "Page A", capturedAt: "2026-09-01T00:00:00.000Z" },
    });
    const docB = makeWebDocument({
      source: { kind: "web", url: "https://example.com/b", site: "example.com" },
      metadata: { title: "Page B", capturedAt: "2026-09-01T00:00:00.000Z" },
    });
    const items = [
      {
        id: "a",
        captureId: "cap-a",
        url: "https://example.com/a",
        capturedAt: docA.metadata.capturedAt,
        title: "Page A",
        sourceKind: "web" as const,
        adapter: { id: "generic-article", name: "Generic Article" },
        scope: "full-page" as const,
        role: "task" as const,
        primary: true,
        document: docA,
      },
      {
        id: "b",
        captureId: "cap-b",
        url: "https://example.com/b",
        capturedAt: docB.metadata.capturedAt,
        title: "Page B",
        sourceKind: "web" as const,
        adapter: { id: "generic-article", name: "Generic Article" },
        scope: "full-page" as const,
        role: "reference" as const,
        primary: false,
        document: docB,
      },
    ];
    let cart = createEmptyCart();
    for (const item of items) {
      const added = addContextSource(cart, item as never);
      if (added.status !== "added") {
        throw new Error("expected added");
      }
      cart = added.cart;
    }
    storage.data[workbenchCartKey(5)] = cart;
    void docB;

    renderApp({ storage, session: capturedSession() });

    // Two sources: Compare is selectable.
    const compare = (await screen.findByRole("radio", { name: /Compare/ })) as HTMLButtonElement;
    expect(compare.disabled).toBe(false);
    await userEvent.click(compare);

    // Clear the cart: the capture candidate becomes the only source again,
    // the persisted Compare choice is gated — the panel must not crash.
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(screen.getByText(/Compare needs at least 2 sources in the Context/)).toBeTruthy();
    });
    expect(screen.queryByText("Context Receipt")).toBeNull();
    expect(screen.getByText("Example Article")).toBeTruthy();
  });

  it("shows a friendly error state with a recovery hint", async () => {
    const session: CaptureSessionDeps = {
      ...SESSION_DEPS,
      readIntent: async () => ({
        schemaVersion: 1,
        captureId: "capture-x",
        startedAt: "2026-09-01T00:00:00.000Z",
      }),
      readOutcome: async () => ({
        schemaVersion: 1,
        status: "error",
        captureId: "capture-x",
        error: { code: "NO_CONTENT_FOUND", message: "Unable to find meaningful page content." },
      }),
    };
    renderApp({ storage: makeStorage(), session });
    expect(await screen.findByText("Unable to find meaningful page content.")).toBeTruthy();
    expect(screen.getByText(/toolbar icon to try again/)).toBeTruthy();
  });
});
