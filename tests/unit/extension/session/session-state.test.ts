import { describe, expect, it } from "vitest";
import {
  CAPTURE_OUTCOME_KEY_PREFIX,
  captureOutcomeKey,
  isCaptureIntentStale,
  isCaptureOutcome,
  isLatestCaptureIntent,
  LATEST_CAPTURE_KEY,
} from "../../../../src/extension/session/session-state";
import type { LatestCaptureIntent } from "../../../../src/extension/session/session-state";
import {
  createSerializedIntentWriter,
  readCaptureOutcome,
  readLatestIntent,
  removeAllOutcomes,
  writeCaptureOutcome,
} from "../../../../src/extension/session/session-storage";
import type { SessionStorage } from "../../../../src/extension/session/session-storage";
import type { CaptureResult } from "../../../../src/extension/capture/capture-result";

function createFakeStorage(initial: Record<string, unknown> = {}): SessionStorage & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (key) => data[key],
    set: async (key, value) => {
      data[key] = value;
    },
    remove: async (key) => {
      delete data[key];
    },
    keys: async () => Object.keys(data),
  };
}

const INTENT_A: LatestCaptureIntent = { schemaVersion: 1, captureId: "a", startedAt: "2026-08-31T00:00:00.000Z" };
const INTENT_B: LatestCaptureIntent = { schemaVersion: 1, captureId: "b", startedAt: "2026-08-31T00:01:00.000Z" };

const RESULT: CaptureResult = {
  schemaVersion: 1,
  captureId: "b",
  tabId: 7,
  url: "https://example.com/b",
  capturedAt: "2026-08-31T00:00:00.000Z",
  sourceKind: "web",
  title: "B",
  actionKind: "use_as_context",
  stats: { characters: 1, codeBlocks: 0, links: 0 },
  markdown: "# B",
  agentContext: "# B",
  filename: "b.md",
};

describe("session validators", () => {
  it("accepts valid intents and rejects malformed ones", () => {
    expect(isLatestCaptureIntent(INTENT_A)).toBe(true);
    expect(isLatestCaptureIntent({ schemaVersion: 2, captureId: "a", startedAt: "t" })).toBe(false);
    expect(isLatestCaptureIntent({ schemaVersion: 1, startedAt: "t" })).toBe(false);
    expect(isLatestCaptureIntent({ schemaVersion: 1, captureId: "a", startedAt: "t", extra: 1 })).toBe(false);
    expect(isLatestCaptureIntent(null)).toBe(false);
  });

  it("accepts captured/error outcomes and rejects malformed ones", () => {
    expect(
      isCaptureOutcome({ schemaVersion: 1, status: "captured", captureId: "b", result: RESULT }),
    ).toBe(true);
    expect(
      isCaptureOutcome({ schemaVersion: 1, status: "error", captureId: "b", error: { code: "NO_CONTENT_FOUND", message: "None." } }),
    ).toBe(true);
    expect(isCaptureOutcome({ schemaVersion: 1, status: "done", captureId: "b" })).toBe(false);
    expect(
      isCaptureOutcome({ schemaVersion: 1, status: "captured", captureId: "b", result: { ...RESULT, schemaVersion: 2 } }),
    ).toBe(false);
  });

  it("computes isolated per-capture outcome keys", () => {
    expect(captureOutcomeKey("b")).toBe(`${CAPTURE_OUTCOME_KEY_PREFIX}b`);
  });

  it("treats intents older than the stale threshold as interrupted", () => {
    expect(isCaptureIntentStale(INTENT_B, "2026-08-31T00:01:10.000Z")).toBe(false);
    const stale = {
      schemaVersion: 1 as const,
      captureId: "b",
      startedAt: "2026-08-31T00:00:00.000Z",
    };
    expect(isCaptureIntentStale(stale, "2026-08-31T00:03:00.000Z")).toBe(true);
    expect(isCaptureIntentStale(INTENT_B, "not-a-date")).toBe(true);
  });
});

describe("intent / outcome storage helpers", () => {
  it("reads null for absent or malformed intents", async () => {
    const storage = createFakeStorage();
    expect(await readLatestIntent(storage)).toBeNull();
    storage.data[LATEST_CAPTURE_KEY] = { garbage: true };
    expect(await readLatestIntent(storage)).toBeNull();
  });

  it("round-trips outcomes under per-capture keys", async () => {
    const storage = createFakeStorage();
    await writeCaptureOutcome(storage, { schemaVersion: 1, status: "captured", captureId: "b", result: RESULT });
    expect(await readCaptureOutcome(storage, "b")).toMatchObject({ status: "captured" });
    expect(await readCaptureOutcome(storage, "other")).toBeNull();
  });

  it("removeAllOutcomes removes only outcome keys", async () => {
    const storage = createFakeStorage({
      [LATEST_CAPTURE_KEY]: INTENT_B,
      [captureOutcomeKey("a")]: { schemaVersion: 1, status: "error", captureId: "a", error: { code: "X", message: "x" } },
      [captureOutcomeKey("b")]: { schemaVersion: 1, status: "captured", captureId: "b", result: RESULT },
      "unrelated.key": 42,
    });
    await removeAllOutcomes(storage);
    expect(storage.data[LATEST_CAPTURE_KEY]).toBeDefined();
    expect(storage.data["unrelated.key"]).toBe(42);
    expect(storage.data[captureOutcomeKey("a")]).toBeUndefined();
    expect(storage.data[captureOutcomeKey("b")]).toBeUndefined();
  });
});

describe("serialized intent writer (click order == durable order)", () => {
  it("writes intents strictly in enqueue order even when writes complete late", async () => {
    const writes: string[] = [];
    const pending: Array<() => void> = [];
    const writer = createSerializedIntentWriter((intent) => {
      writes.push(intent.captureId);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    });

    const writeA = writer.writeIntent(INTENT_A);
    const writeB = writer.writeIntent(INTENT_B);

    // Let A's write start (microtask), then assert B has not started yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toEqual(["a"]);
    pending.shift()?.();
    await writeA;
    await Promise.resolve();
    expect(writes).toEqual(["a", "b"]);
    pending.shift()?.();
    await writeB;
    expect(writes).toEqual(["a", "b"]);
  });

  it("keeps the queue alive after a failed write", async () => {
    const writes: string[] = [];
    const writer = createSerializedIntentWriter(async (intent) => {
      writes.push(intent.captureId);
      if (intent.captureId === "a") {
        throw new Error("storage failed");
      }
    });
    await expect(writer.writeIntent(INTENT_A)).rejects.toThrow("storage failed");
    await writer.writeIntent(INTENT_B);
    expect(writes).toEqual(["a", "b"]);
  });
});

describe("ownership model: stale workers can never revert the latest intent", () => {
  it("keeps C authoritative when B's outcome write lands after C's intent", async () => {
    const storage = createFakeStorage({ [LATEST_CAPTURE_KEY]: INTENT_B });

    // Worker B writes its outcome; its SET is deferred to force interleaving.
    const originalSet = storage.set.bind(storage);
    const deferredSet: Array<() => void> = [];
    storage.set = (key: string, value: unknown) => {
      if (key === captureOutcomeKey("b")) {
        return new Promise<void>((resolve) => {
          deferredSet.push(resolve);
        }).then(async () => {
          await originalSet(key, value);
        });
      }
      return originalSet(key, value);
    };
    const outcomeB = { schemaVersion: 1 as const, status: "captured" as const, captureId: "b", result: RESULT };
    const workerBWrite = writeCaptureOutcome(storage, outcomeB);

    // While B's write is in flight, the user clicks C: the panel writes the
    // new intent (outcome cleanup + intent write happen under the same key).
    await storage.set(LATEST_CAPTURE_KEY, INTENT_C());
    expect(storage.data[LATEST_CAPTURE_KEY]).toMatchObject({ captureId: "c" });

    deferredSet.shift()?.();
    await workerBWrite;

    // Latest intent was never touched by the worker.
    expect(storage.data[LATEST_CAPTURE_KEY]).toMatchObject({ captureId: "c" });
    // B's stale outcome is garbage only; restore picks the latest intent's outcome.
    const outcomeC = { schemaVersion: 1 as const, status: "captured" as const, captureId: "c", result: { ...RESULT, captureId: "c", title: "C" } };
    await writeCaptureOutcome(storage, outcomeC);
    const restored = await readCaptureOutcome(storage, "c");
    expect(restored).toMatchObject({ captureId: "c" });
    expect(storage.data[LATEST_CAPTURE_KEY]).toMatchObject({ captureId: "c" });
  });

  it("cleanup never deletes the outcome of the capture it introduces", async () => {
    // The panel cleans up old outcomes BEFORE writing the new intent; the new
    // capture has no outcome yet at that point. Later outcomes are untouched.
    const storage = createFakeStorage({
      [LATEST_CAPTURE_KEY]: INTENT_B,
      [captureOutcomeKey("b")]: { schemaVersion: 1, status: "captured", captureId: "b", result: RESULT },
    });

    await removeAllOutcomes(storage);
    expect(storage.data[captureOutcomeKey("b")]).toBeUndefined();

    await storage.set(LATEST_CAPTURE_KEY, INTENT_C());
    await writeCaptureOutcome(storage, { schemaVersion: 1, status: "captured", captureId: "c", result: { ...RESULT, captureId: "c", title: "C" } });

    expect(storage.data[captureOutcomeKey("c")]).toBeDefined();
    expect(storage.data[LATEST_CAPTURE_KEY]).toMatchObject({ captureId: "c" });
  });
});

function INTENT_C(): LatestCaptureIntent {
  return { schemaVersion: 1, captureId: "c", startedAt: "t3" };
}
