// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../../../src/extension/sidepanel/App";
import {
  INTERRUPTED_CAPTURE_MESSAGE,
} from "../../../../src/extension/sidepanel/capture-session";
import type { CaptureSessionDeps } from "../../../../src/extension/sidepanel/capture-session";
import type { LatestCaptureIntent } from "../../../../src/extension/session/session-state";
import type { CaptureOutcome } from "../../../../src/extension/session/session-state";
import type { CaptureResult } from "../../../../src/extension/capture/capture-result";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    schemaVersion: 1,
    captureId: "c1",
    tabId: 7,
    url: "https://example.com/article",
    capturedAt: "2026-08-31T00:00:00.000Z",
    sourceKind: "web",
    title: "Example Article",
    actionKind: "use_as_context",
    stats: { characters: 12_420, codeBlocks: 3, links: 8 },
    markdown: "# Example Article\n\nBody.",
    agentContext: "# Page2Agent Context\n\n## Page2Agent Agent Instructions",
    filename: "example-article.md",
    ...overrides,
  };
}

interface FakeDepsOptions {
  intent?: LatestCaptureIntent | null;
  outcomeFor?: (captureId: string) => CaptureOutcome | null;
  sendResponse?: unknown;
  sendRejects?: boolean;
  captureIds?: string[];
  nowValue?: string;
  /** When set, writeIntent calls return these deferred promises in order. */
  deferredIntentWrites?: boolean;
}

function makeDeps(options: FakeDepsOptions = {}): {
  deps: CaptureSessionDeps;
  sentRequests: string[];
  intentWrites: LatestCaptureIntent[];
  unsubscribe: ReturnType<typeof vi.fn>;
  resolveIntentWrites: Array<() => void>;
} {
  const sentRequests: string[] = [];
  const intentWrites: LatestCaptureIntent[] = [];
  const unsubscribe = vi.fn();
  const resolveIntentWrites: Array<() => void> = [];
  let idIndex = 0;
  const captureIds = options.captureIds ?? ["c1", "c2", "c3"];

  const deps: CaptureSessionDeps = {
    sendCaptureRequest: async (captureId: string) => {
      sentRequests.push(captureId);
      if (options.sendRejects === true) {
        throw new Error("channel closed");
      }
      return options.sendResponse;
    },
    readIntent: async () => options.intent ?? null,
    writeIntent: async (intent: LatestCaptureIntent) => {
      intentWrites.push(intent);
      if (options.deferredIntentWrites === true) {
        await new Promise<void>((resolve) => {
          resolveIntentWrites.push(resolve);
        });
      }
    },
    readOutcome: async (captureId: string) => options.outcomeFor?.(captureId) ?? null,
    cleanupOutcomes: async () => undefined,
    subscribeSessionChanges: (_listener: () => void) => {
      return unsubscribe;
    },
    now: () => options.nowValue ?? "2026-08-31T00:00:00.000Z",
    createCaptureId: () => {
      const id = captureIds[idIndex % captureIds.length];
      idIndex += 1;
      return id;
    },
  };
  return { deps, sentRequests, intentWrites, unsubscribe, resolveIntentWrites };
}

function capturedOutcome(intent: LatestCaptureIntent, overrides: Partial<CaptureResult> = {}): CaptureOutcome {
  return {
    schemaVersion: 1,
    status: "captured",
    captureId: intent.captureId,
    result: makeResult({ captureId: intent.captureId, ...overrides }),
  };
}

describe("Side Panel — Idle", () => {
  it("shows the idle state with a capture button", async () => {
    render(<App deps={makeDeps().deps} />);
    expect(screen.getByRole("heading", { name: "Page2Agent" })).toBeTruthy();
    expect(screen.getByText("No page captured yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Capture Current Page" })).toBeTruthy();
  });
});

describe("Side Panel — Capturing", () => {
  it("shows the capturing state and writes the intent before sending", async () => {
    const user = userEvent.setup();
    let resolveSend: ((value: unknown) => void) | undefined;
    const sendPromise = new Promise<unknown>((resolve) => {
      resolveSend = resolve;
    });
    const { deps, sentRequests, intentWrites } = makeDeps();
    deps.sendCaptureRequest = async (captureId: string) => {
      sentRequests.push(captureId);
      return sendPromise;
    };
    render(<App deps={deps} />);

    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    expect(intentWrites[0]).toMatchObject({ schemaVersion: 1, captureId: "c1" });
    expect(sentRequests).toEqual(["c1"]);
    expect(screen.getByText("Capturing current page…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Capture Again" })).toBeTruthy();

    resolveSend?.({
      type: "capture.success",
      captureId: "c1",
      result: makeResult(),
    });
    expect(await screen.findByText("Example Article")).toBeTruthy();
  });
});

describe("Side Panel — Captured", () => {
  it("shows a generic captured view with stats, action label and Agent tab default", async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps({
      sendResponse: { type: "capture.success", captureId: "c1", result: makeResult() },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    expect(screen.getByText("Example Article")).toBeTruthy();
    expect(screen.getByText("Web Page")).toBeTruthy();
    expect(screen.getByText("Use as context")).toBeTruthy();
    expect(screen.getByText("12,420 chars")).toBeTruthy();
    expect(screen.getByText("3 code blocks")).toBeTruthy();
    expect(screen.getByText("8 links")).toBeTruthy();

    const agentTab = screen.getByRole("tab", { name: "Agent" });
    expect(agentTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Page2Agent Context/, { selector: "pre" })).toBeTruthy();
  });

  it("shows GitHub Issue + Fix this issue for a github result", async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps({
      sendResponse: {
        type: "capture.success",
        captureId: "c1",
        result: makeResult({
          sourceKind: "github_issue",
          actionKind: "fix_issue",
          title: "Fix deletion crash",
          filename: "acme-page2agent-demo-issue-42.md",
        }),
      },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    expect(screen.getByText("GitHub Issue")).toBeTruthy();
    expect(screen.getByText("Fix this issue")).toBeTruthy();
    expect(screen.getByText("Fix deletion crash")).toBeTruthy();
    expect(screen.queryByText("Send to Codex")).toBeNull();
  });

  it("switches between Agent and Markdown preview tabs", async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps({
      sendResponse: {
        type: "capture.success",
        captureId: "c1",
        result: makeResult({ markdown: "# Example Article\n\nBody.", agentContext: "agent text" }),
      },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    expect(screen.getByText(/agent text/, { selector: "pre" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(screen.getByRole("tab", { name: "Markdown" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Body\./, { selector: "pre" })).toBeTruthy();
  });

  it("copies the FULL agent context, not the preview", async () => {
    const user = userEvent.setup();
    const fullContext = "full agent context ".repeat(500);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { deps } = makeDeps({
      sendResponse: { type: "capture.success", captureId: "c1", result: makeResult({ agentContext: fullContext }) },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    await user.click(screen.getByRole("button", { name: "Copy for Agent" }));
    expect(writeText).toHaveBeenCalledWith(fullContext);
    expect(screen.getByText("Agent context copied.")).toBeTruthy();
  });

  it("keeps the captured result when clipboard fails (action-level error)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("denied")) },
    });
    const { deps } = makeDeps({
      sendResponse: { type: "capture.success", captureId: "c1", result: makeResult() },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    await user.click(screen.getByRole("button", { name: "Copy for Agent" }));
    expect(screen.getByText("Could not copy to the clipboard. Please try again.")).toBeTruthy();
    expect(screen.getByText("Example Article")).toBeTruthy();
  });

  it("downloads the full markdown with the safe filename", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:page2agent-app");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);

    const { deps } = makeDeps({
      sendResponse: {
        type: "capture.success",
        captureId: "c1",
        result: makeResult({ markdown: "full markdown content", filename: "example-article.md" }),
      },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:page2agent-app");
    expect(screen.getByText("Markdown downloaded.")).toBeTruthy();
  });

  it("shows the explicit truncation marker for over-limit previews", async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps({
      sendResponse: {
        type: "capture.success",
        captureId: "c1",
        result: makeResult({ agentContext: "x".repeat(20_001) }),
      },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    expect(
      screen.getByText("Preview truncated. Copy and download use the full content."),
    ).toBeTruthy();
  });
});

describe("Side Panel — Error", () => {
  it("shows a friendly error and Capture Again", async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps({
      sendResponse: {
        type: "capture.failure",
        captureId: "c1",
        error: { code: "RESTRICTED_PAGE", message: "This browser page cannot be captured." },
      },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));

    expect(screen.getByText("This browser page cannot be captured.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Capture Again" })).toBeTruthy();
  });
});

describe("Side Panel — concurrency", () => {
  it("serializes intent writes in click order even when writes complete late", async () => {
    const user = userEvent.setup();
    const { deps, sentRequests, intentWrites, resolveIntentWrites } = makeDeps({
      captureIds: ["a", "b"],
      deferredIntentWrites: true,
      sendResponse: { type: "capture.success", captureId: "b", result: makeResult({ captureId: "b", title: "Result B" }) },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" })); // A
    await user.click(screen.getByRole("button", { name: "Capture Again" })); // B

    // The queue starts A's write; B's write must wait.
    expect(intentWrites.map((intent) => intent.captureId)).toEqual(["a"]);
    expect(sentRequests).toEqual([]); // requests wait for their own intent write

    resolveIntentWrites.shift()?.(); // A's write completes
    await vi.waitFor(() => expect(intentWrites.map((intent) => intent.captureId)).toEqual(["a", "b"]));
    resolveIntentWrites.shift()?.(); // B's write completes
    await vi.waitFor(() => expect(sentRequests).toEqual(["a", "b"]));

    expect(await screen.findByText("Result B")).toBeTruthy();
  });

  it("ignores a stale success response after a newer capture", async () => {
    const user = userEvent.setup();
    const { deps, sentRequests } = makeDeps({
      captureIds: ["a", "b"],
      sendResponse: {
        type: "capture.success",
        captureId: "b",
        result: makeResult({ captureId: "b", title: "Result B" }),
      },
    });
    render(<App deps={deps} />);
    await user.click(screen.getByRole("button", { name: "Capture Current Page" }));
    await user.click(screen.getByRole("button", { name: "Capture Again" }));

    expect(sentRequests).toEqual(["a", "b"]);
    expect(await screen.findByText("Result B")).toBeTruthy();
  });
});

describe("Side Panel — session restore", () => {
  it("restores a captured session from intent + outcome without a capture request", async () => {
    const intent: LatestCaptureIntent = { schemaVersion: 1, captureId: "old-1", startedAt: "t0" };
    const { deps, sentRequests } = makeDeps({
      intent,
      outcomeFor: () => capturedOutcome(intent, { title: "Restored Title" }),
    });
    render(<App deps={deps} />);

    expect(await screen.findByText("Restored Title")).toBeTruthy();
    expect(await screen.findByText("Use as context")).toBeTruthy();
    expect(sentRequests).toHaveLength(0);
  });

  it("restores an error state with Capture Again", async () => {
    const intent: LatestCaptureIntent = { schemaVersion: 1, captureId: "e1", startedAt: "t0" };
    const outcome: CaptureOutcome = {
      schemaVersion: 1,
      status: "error",
      captureId: "e1",
      error: { code: "NO_CONTENT_FOUND", message: "Unable to find meaningful page content." },
    };
    render(<App deps={makeDeps({ intent, outcomeFor: () => outcome }).deps} />);
    expect(await screen.findByText("Unable to find meaningful page content.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Capture Again" })).toBeTruthy();
  });

  it("shows the interrupted-capture retry message for a stale intent without an outcome", async () => {
    const staleStartedAt = new Date(Date.now() - 121_000).toISOString();
    const intent: LatestCaptureIntent = { schemaVersion: 1, captureId: "dead-1", startedAt: staleStartedAt };
    const { deps } = makeDeps({ intent, outcomeFor: () => null, nowValue: new Date().toISOString() });
    render(<App deps={deps} />);
    expect(await screen.findByText(INTERRUPTED_CAPTURE_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Capture Again" })).toBeTruthy();
  });

  it("shows capturing for a fresh intent without an outcome", async () => {
    const intent: LatestCaptureIntent = { schemaVersion: 1, captureId: "live-1", startedAt: "2026-08-31T00:00:00.000Z" };
    const { deps } = makeDeps({ intent, outcomeFor: () => null });
    render(<App deps={deps} />);
    expect(await screen.findByText("Capturing current page…")).toBeTruthy();
  });

  it("ignores malformed stored state and shows Idle", async () => {
    const { deps } = makeDeps();
    deps.readIntent = async () => ({ garbage: true });
    render(<App deps={deps} />);
    expect(await screen.findByText("No page captured yet.")).toBeTruthy();
  });

  it("subscribes to session changes and unsubscribes on unmount", async () => {
    const { deps, unsubscribe } = makeDeps();
    const { unmount } = render(<App deps={deps} />);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
