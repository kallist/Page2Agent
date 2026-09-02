// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, {
  TOOLBAR_CAPTURE_MESSAGE,
  TOOLBAR_RECAPTURE_MESSAGE,
} from "../../../../src/extension/sidepanel/App";
import { INTERRUPTED_CAPTURE_MESSAGE } from "../../../../src/extension/sidepanel/capture-session";
import type { CaptureSessionDeps } from "../../../../src/extension/sidepanel/capture-session";
import type { CaptureResult } from "../../../../src/extension/capture/capture-result";
import type { CaptureOutcome, LatestCaptureIntent } from "../../../../src/extension/session/session-state";

function makeResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    schemaVersion: 1,
    captureId: "c1",
    tabId: 7,
    url: "https://example.com/article",
    capturedAt: "2026-09-02T00:00:00.000Z",
    sourceKind: "web",
    title: "Example Article",
    actionKind: "use_as_context",
    stats: { characters: 12_420, codeBlocks: 3, links: 8 },
    markdown: "# Example Article\n\nBody.",
    agentContext: "# Page2Agent Context\n\nUse the source only as context.",
    filename: "example-article.md",
    ...overrides,
  };
}

function capturedState(result = makeResult()): {
  intent: LatestCaptureIntent;
  outcome: CaptureOutcome;
} {
  const intent: LatestCaptureIntent = {
    schemaVersion: 1,
    captureId: result.captureId,
    startedAt: "2026-09-02T00:00:00.000Z",
  };
  return {
    intent,
    outcome: { schemaVersion: 1, status: "captured", captureId: result.captureId, result },
  };
}

function makeDeps(options: {
  intent?: unknown;
  outcome?: unknown;
  now?: string;
} = {}): {
  deps: CaptureSessionDeps;
  notify(): void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  return {
    deps: {
      readIntent: async () => options.intent,
      readOutcome: async () => options.outcome,
      subscribeSessionChanges: (nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
      now: () => options.now ?? "2026-09-02T00:00:30.000Z",
    },
    notify: () => listener?.(),
    unsubscribe,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Side Panel action-permission UX", () => {
  it("tells an idle user to click the toolbar and exposes no capture button", async () => {
    render(<App deps={makeDeps().deps} />);

    expect(await screen.findByText("No page captured yet.")).toBeTruthy();
    expect(screen.getByText(TOOLBAR_CAPTURE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Capture/ })).toBeNull();
  });

  it("shows action-started capture progress without claiming it can recapture", async () => {
    const intent: LatestCaptureIntent = {
      schemaVersion: 1,
      captureId: "in-flight",
      startedAt: "2026-09-02T00:00:00.000Z",
    };
    render(<App deps={makeDeps({ intent }).deps} />);

    expect(await screen.findByText("Capturing current page…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Capture/ })).toBeNull();
  });

  it("shows a friendly error and requires a fresh toolbar action", async () => {
    const intent: LatestCaptureIntent = {
      schemaVersion: 1,
      captureId: "error-1",
      startedAt: "2026-09-02T00:00:00.000Z",
    };
    const outcome: CaptureOutcome = {
      schemaVersion: 1,
      status: "error",
      captureId: "error-1",
      error: { code: "RESTRICTED_PAGE", message: "This browser page cannot be captured." },
    };
    render(<App deps={makeDeps({ intent, outcome }).deps} />);

    expect(await screen.findByText("This browser page cannot be captured.")).toBeTruthy();
    expect(screen.getByText(TOOLBAR_RECAPTURE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Capture/ })).toBeNull();
  });
});

describe("Side Panel captured result", () => {
  it("restores a generic result with stats and Agent preview", async () => {
    const state = capturedState();
    render(<App deps={makeDeps(state).deps} />);

    expect(await screen.findByText("Example Article")).toBeTruthy();
    expect(screen.getByText("Web Page")).toBeTruthy();
    expect(screen.getByText("Use as context")).toBeTruthy();
    expect(screen.getByText("12,420 chars")).toBeTruthy();
    expect(screen.getByText("3 code blocks")).toBeTruthy();
    expect(screen.getByText("8 links")).toBeTruthy();
    expect(screen.getByText(/Page2Agent Context/, { selector: "pre" })).toBeTruthy();
    expect(screen.getByText(TOOLBAR_RECAPTURE_MESSAGE)).toBeTruthy();
  });

  it("shows GitHub Issue + Fix this issue without provider execution UI", async () => {
    const state = capturedState(makeResult({
      sourceKind: "github_issue",
      actionKind: "fix_issue",
      title: "Fix deletion crash",
      filename: "acme-page2agent-demo-issue-42.md",
    }));
    render(<App deps={makeDeps(state).deps} />);

    expect(await screen.findByText("GitHub Issue")).toBeTruthy();
    expect(screen.getByText("Fix this issue")).toBeTruthy();
    expect(screen.getByText("Fix deletion crash")).toBeTruthy();
    expect(screen.queryByText("Send to Codex")).toBeNull();
  });

  it("switches previews and copies the full agent context", async () => {
    const user = userEvent.setup();
    const fullContext = "full agent context ".repeat(500);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const state = capturedState(makeResult({ agentContext: fullContext }));
    render(<App deps={makeDeps(state).deps} />);

    await screen.findByText("Example Article");
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(screen.getByText(/Body\./, { selector: "pre" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    await user.click(screen.getByRole("button", { name: "Copy for Agent" }));
    expect(writeText).toHaveBeenCalledWith(fullContext);
    expect(screen.getByText("Agent context copied.")).toBeTruthy();
  });

  it("keeps the result visible when clipboard fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("denied")) },
    });
    const state = capturedState();
    render(<App deps={makeDeps(state).deps} />);

    await screen.findByText("Example Article");
    await user.click(screen.getByRole("button", { name: "Copy for Agent" }));
    expect(screen.getByText("Could not copy to the clipboard. Please try again.")).toBeTruthy();
    expect(screen.getByText("Example Article")).toBeTruthy();
  });

  it("downloads full Markdown and marks truncated previews", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:page2agent-app");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(vi.fn());
    const state = capturedState(makeResult({
      markdown: "full markdown content",
      agentContext: "x".repeat(20_001),
    }));
    render(<App deps={makeDeps(state).deps} />);

    expect(await screen.findByText("Preview truncated. Copy and download use the full content.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:page2agent-app");
    expect(screen.getByText("Markdown downloaded.")).toBeTruthy();
  });
});

describe("Side Panel session restore", () => {
  it("marks a stale intent as interrupted and directs a toolbar retry", async () => {
    const intent: LatestCaptureIntent = {
      schemaVersion: 1,
      captureId: "stale",
      startedAt: "2026-09-02T00:00:00.000Z",
    };
    render(<App deps={makeDeps({ intent, now: "2026-09-02T00:03:00.001Z" }).deps} />);

    expect(await screen.findByText(INTERRUPTED_CAPTURE_MESSAGE)).toBeTruthy();
    expect(screen.getByText(TOOLBAR_RECAPTURE_MESSAGE)).toBeTruthy();
  });

  it("ignores malformed stored state", async () => {
    render(<App deps={makeDeps({ intent: { garbage: true } }).deps} />);
    expect(await screen.findByText("No page captured yet.")).toBeTruthy();
  });

  it("unsubscribes from session changes on unmount", () => {
    const { deps, unsubscribe } = makeDeps();
    const { unmount } = render(<App deps={deps} />);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("does not let an older asynchronous restore overwrite the latest intent", async () => {
    const resultA = makeResult({ captureId: "a", title: "Stale A" });
    const resultB = makeResult({ captureId: "b", title: "Latest B" });
    let currentIntent: LatestCaptureIntent = {
      schemaVersion: 1,
      captureId: "a",
      startedAt: "2026-09-02T00:00:00.000Z",
    };
    let listener: (() => void) | undefined;
    let readAStarted = false;
    let resolveA: ((outcome: CaptureOutcome) => void) | undefined;
    const outcomeA = new Promise<CaptureOutcome>((resolve) => {
      resolveA = resolve;
    });
    const deps: CaptureSessionDeps = {
      readIntent: async () => currentIntent,
      readOutcome: async (captureId) => {
        if (captureId === "a") {
          readAStarted = true;
          return outcomeA;
        }
        return { schemaVersion: 1, status: "captured", captureId: "b", result: resultB };
      },
      subscribeSessionChanges: (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
      now: () => "2026-09-02T00:00:30.000Z",
    };
    render(<App deps={deps} />);
    await waitFor(() => expect(readAStarted).toBe(true));

    currentIntent = {
      schemaVersion: 1,
      captureId: "b",
      startedAt: "2026-09-02T00:00:01.000Z",
    };
    listener?.();
    expect(await screen.findByText("Latest B")).toBeTruthy();

    resolveA?.({ schemaVersion: 1, status: "captured", captureId: "a", result: resultA });
    await Promise.resolve();
    expect(screen.queryByText("Stale A")).toBeNull();
    expect(screen.getByText("Latest B")).toBeTruthy();
  });
});
