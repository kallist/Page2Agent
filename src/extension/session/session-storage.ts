/**
 * chrome.storage.session access for the intent/outcome ownership model.
 *
 * - Latest intent key: Side Panel only, namespaced by browser window and
 *   serialized through that panel instance's intent writer.
 * - Outcome keys: per capture, Service Worker only.
 *
 * Compare-before-write is NOT used: correctness comes from key ownership, not
 * from read-modify-write of a shared key.
 */
import {
  captureOutcomeKey,
  isCaptureOutcome,
  isLatestCaptureIntent,
  latestCaptureIntentKey,
} from "./session-state";
import type { CaptureOutcome, LatestCaptureIntent } from "./session-state";

/** Minimal async KV interface so tests can use fakes (no DI framework). */
export interface SessionStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export const chromeSessionStorage: SessionStorage = {
  async get(key: string): Promise<unknown> {
    const data = await chrome.storage.session.get(key);
    return data[key];
  },
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.session.set({ [key]: value });
  },
  async remove(key: string): Promise<void> {
    await chrome.storage.session.remove(key);
  },
};

/** Read + validate the latest intent; invalid/absent → null (never crash). */
export async function readLatestIntent(
  storage: SessionStorage,
  windowId: number,
): Promise<LatestCaptureIntent | null> {
  const raw = await storage.get(latestCaptureIntentKey(windowId));
  return isLatestCaptureIntent(raw) ? raw : null;
}

/** Read + validate one capture outcome; invalid/absent → null. */
export async function readCaptureOutcome(
  storage: SessionStorage,
  captureId: string,
): Promise<CaptureOutcome | null> {
  const raw = await storage.get(captureOutcomeKey(captureId));
  return isCaptureOutcome(raw) ? raw : null;
}

/** Worker: write this capture's outcome under its own per-capture key. */
export async function writeCaptureOutcome(
  storage: SessionStorage,
  outcome: CaptureOutcome,
): Promise<void> {
  await storage.set(captureOutcomeKey(outcome.captureId), outcome);
}

/**
 * Serialized intent writer: each write waits for the previous one, so the
 * durable intent order always matches the user click order even when storage
 * calls complete out of order. A failed write does not block later writes.
 */
export interface IntentWriter {
  writeIntent(intent: LatestCaptureIntent): Promise<void>;
}

export function createSerializedIntentWriter(
  write: (intent: LatestCaptureIntent) => Promise<void>,
): IntentWriter {
  let chain: Promise<void> = Promise.resolve();
  return {
    writeIntent(intent: LatestCaptureIntent): Promise<void> {
      const next = chain.then(() => write(intent));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

/**
 * Hygiene only: remove one superseded outcome after its window's new intent is
 * durable. Correctness never depends on this, and another window's current
 * outcome is never touched.
 */
export async function removeCaptureOutcome(
  storage: SessionStorage,
  captureId: string,
): Promise<void> {
  await storage.remove(captureOutcomeKey(captureId));
}
