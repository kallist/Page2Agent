import { describe, expect, it } from "vitest";
import { handleCaptureRequest } from "../../../../src/extension/background/capture";
import type { CaptureRuntimeDeps } from "../../../../src/extension/background/capture";
import {
  CAPTURE_REQUEST,
  CONTENT_CAPTURE_SUCCESS,
} from "../../../../src/extension/messaging/runtime-messages";
import {
  CAPTURE_SESSION_KEY,
  isCaptureSessionState,
} from "../../../../src/extension/session/session-state";
import { writeCapturingState } from "../../../../src/extension/session/session-storage";
import type { SessionStorage } from "../../../../src/extension/session/session-storage";
import type { NormalizedDocument } from "../../../../src/core";

const WEB_DOCUMENT: NormalizedDocument = {
  schemaVersion: 1,
  source: { kind: "web", url: "https://example.com/article" },
  metadata: { title: "Example Article", capturedAt: "2026-08-31T00:00:00.000Z" },
  blocks: [
    { type: "paragraph", text: "Body text." },
    { type: "code", code: "const x = 1;" },
    { type: "link", href: "https://example.com/docs", text: "docs" },
  ],
  assets: [],
};

const GITHUB_DOCUMENT: NormalizedDocument = {
  schemaVersion: 1,
  source: {
    kind: "github_issue",
    url: "https://github.com/acme/page2agent-demo/issues/42",
    owner: "acme",
    repo: "page2agent-demo",
    issueNumber: 42,
  },
  metadata: { title: "Fix deletion crash", capturedAt: "2026-08-31T00:00:00.000Z" },
  blocks: [
    { type: "paragraph", text: "App crashes." },
    { type: "heading", level: 2, text: "Acceptance Criteria" },
    { type: "list", ordered: false, items: ["[x] Latest capture wins"] },
  ],
  assets: [],
};

function createFakeStorage(): SessionStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => data[key],
    set: async (key, value) => {
      data[key] = value;
    },
    remove: async (key) => {
      delete data[key];
    },
  };
}

interface FakeCalls {
  injections: number[];
}

function makeDeps(overrides: Partial<CaptureRuntimeDeps> = {}): {
  deps: CaptureRuntimeDeps;
  storage: SessionStorage & { data: Record<string, unknown> };
  calls: FakeCalls;
} {
  const storage = createFakeStorage();
  const calls: FakeCalls = { injections: [] };
  const deps: CaptureRuntimeDeps = {
    queryActiveTab: async () => ({ id: 7, url: "https://example.com/article", title: "Example" }),
    getTab: async () => ({ id: 7, url: "https://example.com/article" }),
    injectContentScript: async (tabId) => {
      calls.injections.push(tabId);
    },
    sendMessageToTab: async () => ({
      type: CONTENT_CAPTURE_SUCCESS,
      captureId: "c1",
      document: WEB_DOCUMENT,
    }),
    storage,
    ...overrides,
  };
  return { deps, storage, calls };
}

async function capturing(storage: SessionStorage, captureId: string): Promise<void> {
  await writeCapturingState(storage, captureId, "2026-08-31T00:00:00.000Z");
}

describe("handleCaptureRequest — success paths", () => {
  it("produces a full CaptureResult for a generic page and commits it", async () => {
    const { deps, storage } = makeDeps();
    await capturing(storage, "c1");
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);

    expect(response.type).toBe("capture.success");
    if (response.type !== "capture.success") {
      throw new Error("expected success");
    }
    expect(response.captureId).toBe("c1");
    expect(response.result.tabId).toBe(7);
    expect(response.result.url).toBe("https://example.com/article");
    expect(response.result.sourceKind).toBe("web");
    expect(response.result.actionKind).toBe("use_as_context");
    expect(response.result.title).toBe("Example Article");
    expect(response.result.stats).toEqual({ characters: 50, codeBlocks: 1, links: 1 });
    expect(response.result.markdown).toContain("# Example Article");
    expect(response.result.agentContext).toContain("# Page2Agent Context");
    expect(response.result.agentContext).toContain("Use the source only as context");
    expect(response.result.filename).toBe("example-article.md");

    const state = storage.data[CAPTURE_SESSION_KEY];
    expect(isCaptureSessionState(state) && state.status).toBe("captured");
  });

  it("produces a fix_issue result with GitHub identity filename and Source AC", async () => {
    const { deps, storage } = makeDeps({
      queryActiveTab: async () => ({
        id: 9,
        url: "https://github.com/acme/page2agent-demo/issues/42",
        title: "Fix deletion crash",
      }),
      getTab: async () => ({ id: 9, url: "https://github.com/acme/page2agent-demo/issues/42" }),
      sendMessageToTab: async () => ({
        type: CONTENT_CAPTURE_SUCCESS,
        captureId: "c1",
        document: GITHUB_DOCUMENT,
      }),
    });
    await capturing(storage, "c1");
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);

    if (response.type !== "capture.success") {
      throw new Error("expected success");
    }
    expect(response.result.sourceKind).toBe("github_issue");
    expect(response.result.actionKind).toBe("fix_issue");
    expect(response.result.filename).toBe("acme-page2agent-demo-issue-42.md");
    expect(response.result.agentContext).toContain("## Source Acceptance Criteria");
    expect(response.result.agentContext).toContain("- [x] Latest capture wins");
  });

  it("uses a deterministic title fallback when the tab has no title", async () => {
    const { deps, storage } = makeDeps({
      queryActiveTab: async () => ({ id: 7, url: "https://example.com/article" }),
    });
    await capturing(storage, "c1");
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response.type).toBe("capture.success");
  });
});

describe("handleCaptureRequest — failure paths", () => {
  it("rejects malformed requests with INVALID_MESSAGE", async () => {
    const { deps } = makeDeps();
    const response = await handleCaptureRequest({ type: "capture.other", captureId: "x" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "INVALID_MESSAGE" } });
  });

  it("fails with CAPTURE_FAILED when the active tab is unavailable", async () => {
    const { deps } = makeDeps({ queryActiveTab: async () => ({}) });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "CAPTURE_FAILED" } });
  });

  it("rejects restricted URLs before injection", async () => {
    const { deps, calls } = makeDeps({
      queryActiveTab: async () => ({ id: 7, url: "chrome://extensions", title: "Extensions" }),
    });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "RESTRICTED_PAGE" } });
    expect(calls.injections).toHaveLength(0);
  });

  it("maps injection failure to RESTRICTED_PAGE", async () => {
    const { deps } = makeDeps({
      injectContentScript: async () => {
        throw new Error("permission denied");
      },
    });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "RESTRICTED_PAGE" } });
  });

  it("propagates content capture failures and commits the error", async () => {
    const { deps, storage } = makeDeps({
      sendMessageToTab: async () => ({
        type: "content.capture.failure",
        captureId: "c1",
        error: { code: "NO_CONTENT_FOUND", message: "Unable to find meaningful page content." },
      }),
    });
    await capturing(storage, "c1");
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({
      type: "capture.failure",
      error: { code: "NO_CONTENT_FOUND" },
    });
    const state = storage.data[CAPTURE_SESSION_KEY];
    expect(isCaptureSessionState(state) && state.status).toBe("error");
  });

  it("rejects invalid documents from content with INVALID_DOCUMENT", async () => {
    const { deps } = makeDeps({
      sendMessageToTab: async () => ({
        type: CONTENT_CAPTURE_SUCCESS,
        captureId: "c1",
        document: { ...WEB_DOCUMENT, schemaVersion: 2 },
      }),
    });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "INVALID_DOCUMENT" } });
  });

  it("rejects unknown content responses with INVALID_MESSAGE", async () => {
    const { deps } = makeDeps({ sendMessageToTab: async () => "unexpected" });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "INVALID_MESSAGE" } });
  });

  it("fails with PAGE_NAVIGATED when the tab URL changed after extraction", async () => {
    const { deps } = makeDeps({
      getTab: async () => ({ id: 7, url: "https://example.com/other" }),
    });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "PAGE_NAVIGATED" } });
  });

  it("fails with CAPTURE_FAILED when the tab is gone after extraction", async () => {
    const { deps } = makeDeps({
      getTab: async () => {
        throw new Error("No tab with id");
      },
    });
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "c1" }, deps);
    expect(response).toMatchObject({ type: "capture.failure", error: { code: "CAPTURE_FAILED" } });
  });
});

describe("handleCaptureRequest — latest capture gate", () => {
  it("returns success but does NOT commit when a newer capture owns the session", async () => {
    const { deps, storage } = makeDeps();
    await capturing(storage, "b"); // user clicked B after A
    const response = await handleCaptureRequest({ type: CAPTURE_REQUEST, captureId: "a" }, deps);

    expect(response.type).toBe("capture.success"); // panel's own gate ignores stale A
    const state = storage.data[CAPTURE_SESSION_KEY];
    expect(isCaptureSessionState(state) && state.status).toBe("capturing");
    expect(isCaptureSessionState(state) && state.captureId).toBe("b");
  });
});
