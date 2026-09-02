/**
 * TOCTOU regression — post-fix ownership model.
 *
 * Same interleaving that failed pre-fix:
 *   intent = B → worker B completes late (outcome write in flight)
 *   → user clicks C → intent = C → worker B's outcome write lands
 *
 * Under the ownership model the worker only ever writes ITS OWN per-capture
 * outcome key; the latest intent key is Side-Panel-owned, so the assertion
 * "C remains authoritative" must PASS here (it FAILED against the TASK 07
 * single-key read→compare→write design).
 */
import { describe, expect, it } from "vitest";
import {
  captureOutcomeKey,
  latestCaptureIntentKey,
} from "../../../../src/extension/session/session-state";
import {
  readLatestIntent,
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
  };
}

const RESULT_B: CaptureResult = {
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

const WINDOW_ID = 12;
const LATEST_CAPTURE_KEY = latestCaptureIntentKey(WINDOW_ID);

describe("TOCTOU: stale worker completion must not revert the latest user intent", () => {
  it("keeps C authoritative when B completes after C's intent was written", async () => {
    const storage = createFakeStorage({
      [LATEST_CAPTURE_KEY]: { schemaVersion: 1, captureId: "b", startedAt: "t1" },
    });

    // Worker B's outcome write is deferred to force the interleaving.
    const deferredSet: Array<() => void> = [];
    const originalSet = storage.set.bind(storage);
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

    const workerBWrite = writeCaptureOutcome(storage, {
      schemaVersion: 1,
      status: "captured",
      captureId: "b",
      result: RESULT_B,
    });

    // While B's outcome write is in flight, the user clicks C: the panel
    // writes the new intent (its own key).
    await storage.set(LATEST_CAPTURE_KEY, { schemaVersion: 1, captureId: "c", startedAt: "t2" });

    deferredSet.shift()?.();
    await workerBWrite;

    // The latest intent remains C — the worker never wrote the intent key.
    const intent = await readLatestIntent(storage, WINDOW_ID);
    expect(intent?.captureId).toBe("c");
    expect(storage.data[LATEST_CAPTURE_KEY]).toMatchObject({ captureId: "c" });

    // Worker C's own outcome completes normally and wins the restore.
    await writeCaptureOutcome(storage, {
      schemaVersion: 1,
      status: "captured",
      captureId: "c",
      result: { ...RESULT_B, captureId: "c", title: "C" },
    });
    expect(storage.data[captureOutcomeKey("c")]).toMatchObject({ captureId: "c" });
    expect(storage.data[LATEST_CAPTURE_KEY]).toMatchObject({ captureId: "c" });
  });
});
