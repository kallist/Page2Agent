import { describe, expect, it } from "vitest";
import { isCaptureSessionState, CAPTURE_SESSION_KEY } from "../../../../src/extension/session/session-state";
import {
  commitCaptureErrorIfCurrent,
  commitCaptureResultIfCurrent,
  readCaptureSession,
  writeCapturingState,
} from "../../../../src/extension/session/session-storage";
import type { SessionStorage } from "../../../../src/extension/session/session-storage";
import type { CaptureResult } from "../../../../src/extension/capture/capture-result";

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

const RESULT: CaptureResult = {
  schemaVersion: 1,
  captureId: "b",
  tabId: 7,
  url: "https://example.com/article",
  capturedAt: "2026-08-31T00:00:00.000Z",
  sourceKind: "web",
  title: "Example",
  actionKind: "use_as_context",
  stats: { characters: 5, codeBlocks: 0, links: 0 },
  markdown: "# Example",
  agentContext: "# Page2Agent Context",
  filename: "example.md",
};

describe("isCaptureSessionState", () => {
  it("accepts capturing, captured and error states", () => {
    expect(isCaptureSessionState({ schemaVersion: 1, status: "capturing", captureId: "a", startedAt: "2026-08-31T00:00:00.000Z" })).toBe(true);
    expect(isCaptureSessionState({ schemaVersion: 1, status: "captured", captureId: "a", result: RESULT })).toBe(true);
    expect(isCaptureSessionState({ schemaVersion: 1, status: "error", captureId: "a", error: { code: "NO_CONTENT_FOUND", message: "None." } })).toBe(true);
  });

  it("rejects malformed states", () => {
    expect(isCaptureSessionState({ schemaVersion: 2, status: "capturing", captureId: "a", startedAt: "x" })).toBe(false);
    expect(isCaptureSessionState({ schemaVersion: 1, status: "done", captureId: "a" })).toBe(false);
    expect(isCaptureSessionState({ schemaVersion: 1, status: "capturing", startedAt: "x" })).toBe(false);
    expect(isCaptureSessionState({ schemaVersion: 1, status: "capturing", captureId: "a", startedAt: "x", extra: 1 })).toBe(false);
    expect(isCaptureSessionState({ schemaVersion: 1, status: "captured", captureId: "a", result: { ...RESULT, schemaVersion: 2 } })).toBe(false);
    expect(isCaptureSessionState(null)).toBe(false);
  });
});

describe("session storage helpers", () => {
  it("writes and reads a capturing state", async () => {
    const storage = createFakeStorage();
    await writeCapturingState(storage, "a", "2026-08-31T00:00:00.000Z");
    const state = await readCaptureSession(storage);
    expect(state).toEqual({ schemaVersion: 1, status: "capturing", captureId: "a", startedAt: "2026-08-31T00:00:00.000Z" });
    expect(storage.data[CAPTURE_SESSION_KEY]).toBeDefined();
  });

  it("returns null for absent or invalid stored state", async () => {
    const storage = createFakeStorage();
    expect(await readCaptureSession(storage)).toBeNull();
    storage.data[CAPTURE_SESSION_KEY] = { garbage: true };
    expect(await readCaptureSession(storage)).toBeNull();
  });
});

describe("latest capture wins — compare-before-write", () => {
  it("commits only when the capture is still the current capturing state", async () => {
    const storage = createFakeStorage();
    await writeCapturingState(storage, "a", "2026-08-31T00:00:00.000Z");

    expect(await commitCaptureResultIfCurrent(storage, "a", RESULT)).toBe(true);
    expect((await readCaptureSession(storage))?.status).toBe("captured");

    // A second commit for the same id is rejected (state no longer capturing).
    expect(await commitCaptureResultIfCurrent(storage, "a", RESULT)).toBe(false);
  });

  it("rejects stale commits with a mismatched captureId", async () => {
    const storage = createFakeStorage();
    await writeCapturingState(storage, "b", "2026-08-31T00:00:00.000Z");
    expect(await commitCaptureResultIfCurrent(storage, "a", RESULT)).toBe(false);
    const state = await readCaptureSession(storage);
    expect(state?.status).toBe("capturing");
    expect(state?.captureId).toBe("b");
  });

  it("rejects commits when no capturing state exists", async () => {
    const storage = createFakeStorage();
    expect(await commitCaptureResultIfCurrent(storage, "a", RESULT)).toBe(false);
  });

  it("A completes after B → B stays (A result and A error both rejected)", async () => {
    const storage = createFakeStorage();
    await writeCapturingState(storage, "a", "t1");
    await writeCapturingState(storage, "b", "t2");

    expect(await commitCaptureResultIfCurrent(storage, "a", RESULT)).toBe(false);
    expect(await commitCaptureErrorIfCurrent(storage, "a", { code: "CAPTURE_FAILED", message: "x" })).toBe(false);
    expect(await commitCaptureResultIfCurrent(storage, "b", RESULT)).toBe(true);

    const state = await readCaptureSession(storage);
    expect(state?.status).toBe("captured");
    expect(state?.captureId).toBe("b");
    expect((state as { result?: CaptureResult }).result?.captureId).toBe("b");
  });

  it("stale error never overwrites a newer success", async () => {
    const storage = createFakeStorage();
    await writeCapturingState(storage, "a", "t1");
    await writeCapturingState(storage, "b", "t2");
    expect(await commitCaptureResultIfCurrent(storage, "b", RESULT)).toBe(true);
    expect(await commitCaptureErrorIfCurrent(storage, "a", { code: "CAPTURE_FAILED", message: "x" })).toBe(false);
    expect((await readCaptureSession(storage))?.status).toBe("captured");
  });
});
