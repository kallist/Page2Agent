import { describe, expect, it, vi } from "vitest";
import { createActionClickHandler } from "../../../../src/extension/background/action-capture";
import type { ActionCaptureDeps } from "../../../../src/extension/background/action-capture";
import { captureOutcomeKey, latestCaptureIntentKey } from "../../../../src/extension/session/session-state";
import type { SessionStorage } from "../../../../src/extension/session/session-storage";

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

function makeDeps(ids = ["capture-1"]): {
  deps: ActionCaptureDeps;
  storage: ReturnType<typeof createFakeStorage>;
  openedWindows: number[];
  capturedTargets: Array<{ captureId: string; id: number; windowId: number; url: string; title?: string }>;
} {
  const storage = createFakeStorage();
  const openedWindows: number[] = [];
  const capturedTargets: Array<{ captureId: string; id: number; windowId: number; url: string; title?: string }> = [];
  const remainingIds = [...ids];
  const deps: ActionCaptureDeps = {
    storage,
    openSidePanel: async (windowId) => {
      openedWindows.push(windowId);
    },
    capture: async (captureId, target) => {
      capturedTargets.push({ captureId, ...target });
      return {
        type: "capture.failure",
        captureId,
        error: { code: "NO_CONTENT_FOUND", message: "No content." },
      };
    },
    createCaptureId: () => remainingIds.shift() ?? "unexpected-id",
    now: () => "2026-09-02T00:00:00.000Z",
  };
  return { deps, storage, openedWindows, capturedTargets };
}

describe("toolbar action capture", () => {
  it("opens the Side Panel and captures the exact clicked tab with its window", async () => {
    const { deps, storage, openedWindows, capturedTargets } = makeDeps();
    const handleActionClick = createActionClickHandler(deps);

    await handleActionClick({
      id: 42,
      windowId: 9,
      url: "https://example.com/exact",
      title: "Exact page",
      active: true,
      index: 3,
    });

    expect(openedWindows).toEqual([9]);
    expect(capturedTargets).toEqual([{
      captureId: "capture-1",
      id: 42,
      windowId: 9,
      url: "https://example.com/exact",
      title: "Exact page",
    }]);
    expect(storage.data[latestCaptureIntentKey(9)]).toMatchObject({
      captureId: "capture-1",
    });
  });

  it("invokes sidePanel.open synchronously before the first async intent write", async () => {
    const { deps } = makeDeps();
    const events: string[] = [];
    deps.openSidePanel = async () => {
      events.push("open");
    };
    deps.storage.get = async () => {
      events.push("intent-read");
      return undefined;
    };
    const handleActionClick = createActionClickHandler(deps);

    const pending = handleActionClick({ id: 1, windowId: 2, url: "https://example.com" });
    expect(events).toEqual(["open"]);
    await pending;
    expect(events[1]).toBe("intent-read");
  });

  it("fails safely for missing tab fields and never starts injection", async () => {
    const { deps, storage, capturedTargets } = makeDeps();
    const handleActionClick = createActionClickHandler(deps);

    const response = await handleActionClick({ windowId: 9, url: "https://example.com" });

    expect(response).toMatchObject({
      type: "capture.failure",
      captureId: "capture-1",
      error: { code: "INVALID_MESSAGE" },
    });
    expect(capturedTargets).toHaveLength(0);
    expect(storage.data[captureOutcomeKey("capture-1")]).toMatchObject({
      status: "error",
      error: { code: "INVALID_MESSAGE" },
    });
  });

  it("fails closed without opening a panel when windowId is malformed", async () => {
    const { deps, openedWindows, capturedTargets } = makeDeps();
    const handleActionClick = createActionClickHandler(deps);

    const response = await handleActionClick({ id: 1, windowId: -1, url: "https://example.com" });

    expect(response).toMatchObject({ type: "capture.failure", error: { code: "INVALID_MESSAGE" } });
    expect(openedWindows).toHaveLength(0);
    expect(capturedTargets).toHaveLength(0);
  });

  it("keeps simultaneous browser windows in separate latest-intent namespaces", async () => {
    const { deps, storage, capturedTargets } = makeDeps(["window-a", "window-b"]);
    const handleActionClick = createActionClickHandler(deps);

    await Promise.all([
      handleActionClick({ id: 10, windowId: 100, url: "https://a.example/page" }),
      handleActionClick({ id: 20, windowId: 200, url: "https://b.example/page" }),
    ]);

    expect(storage.data[latestCaptureIntentKey(100)]).toMatchObject({ captureId: "window-a" });
    expect(storage.data[latestCaptureIntentKey(200)]).toMatchObject({ captureId: "window-b" });
    expect(capturedTargets.map((target) => target.windowId).sort()).toEqual([100, 200]);
  });

  it("does not let a delayed intent write in one window block another window", async () => {
    const { deps, storage, capturedTargets } = makeDeps(["window-a", "window-b"]);
    let finishWindowA: (() => void) | undefined;
    const originalSet = storage.set.bind(storage);
    storage.set = async (key, value) => {
      if (key === latestCaptureIntentKey(100)) {
        await new Promise<void>((resolve) => {
          finishWindowA = resolve;
        });
      }
      await originalSet(key, value);
    };
    const handleActionClick = createActionClickHandler(deps);

    const windowA = handleActionClick({ id: 10, windowId: 100, url: "https://a.example/page" });
    const windowB = handleActionClick({ id: 20, windowId: 200, url: "https://b.example/page" });
    await vi.waitFor(() =>
      expect(capturedTargets.some((target) => target.windowId === 200)).toBe(true),
    );
    expect(capturedTargets.some((target) => target.windowId === 100)).toBe(false);

    finishWindowA?.();
    await Promise.all([windowA, windowB]);
    expect(capturedTargets.map((target) => target.windowId).sort()).toEqual([100, 200]);
  });

  it("serializes overlapping action intents in click order within one window", async () => {
    const { deps, storage } = makeDeps(["first", "second"]);
    const writes: string[] = [];
    let finishFirstWrite: (() => void) | undefined;
    const originalSet = storage.set.bind(storage);
    storage.set = async (key, value) => {
      if (key === latestCaptureIntentKey(9)) {
        const captureId = (value as { captureId: string }).captureId;
        writes.push(captureId);
        if (captureId === "first") {
          await new Promise<void>((resolve) => {
            finishFirstWrite = resolve;
          });
        }
      }
      await originalSet(key, value);
    };
    const handleActionClick = createActionClickHandler(deps);

    const first = handleActionClick({ id: 1, windowId: 9, url: "https://example.com/first" });
    const second = handleActionClick({ id: 2, windowId: 9, url: "https://example.com/second" });
    await vi.waitFor(() => expect(writes).toEqual(["first"]));
    finishFirstWrite?.();
    await Promise.all([first, second]);

    expect(writes).toEqual(["first", "second"]);
    expect(storage.data[latestCaptureIntentKey(9)]).toMatchObject({ captureId: "second" });
  });

  it("continues capture if opening the Side Panel rejects", async () => {
    const { deps, capturedTargets } = makeDeps();
    deps.openSidePanel = vi.fn().mockRejectedValue(new Error("gesture rejected"));
    const handleActionClick = createActionClickHandler(deps);

    await handleActionClick({ id: 7, windowId: 8, url: "https://example.com" });

    expect(capturedTargets).toHaveLength(1);
  });
});
