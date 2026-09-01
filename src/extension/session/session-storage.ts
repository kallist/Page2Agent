/**
 * chrome.storage.session access for the intent/outcome ownership model.
 *
 * - Latest intent key: Side Panel only (serialized through the intent writer).
 * - Outcome keys: per capture, Service Worker only.
 *
 * Compare-before-write is NOT used: correctness comes from key ownership, not
 * from read-modify-write of a shared key.
 */
import {
  CAPTURE_OUTCOME_KEY_PREFIX,
  LATEST_CAPTURE_KEY,
  captureOutcomeKey,
  isCaptureOutcome,
  isLatestCaptureIntent,
} from "./session-state";
import type { CaptureOutcome, LatestCaptureIntent } from "./session-state";

/** Minimal async KV interface so tests can use fakes (no DI framework). */
export interface SessionStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** All session keys (production: chrome.storage.session.get(null)). */
  keys(): Promise<string[]>;
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
  async keys(): Promise<string[]> {
    const all = await chrome.storage.session.get(null);
    return Object.keys(all);
  },
};

/** Read + validate the latest intent; invalid/absent → null (never crash). */
export async function readLatestIntent(
  storage: SessionStorage,
): Promise<LatestCaptureIntent | null> {
  const raw = await storage.get(LATEST_CAPTURE_KEY);
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
 * Hygiene only: remove all outcome keys. Correctness never depends on this —
 * restore only reads the latest intent's outcome key. Called when a new
 * capture intent is written (the new capture has no outcome yet, so this can
 * never delete the current capture's outcome).
 */
export async function removeAllOutcomes(storage: SessionStorage): Promise<void> {
  const keys = await storage.keys();
  for (const key of keys) {
    if (key.startsWith(CAPTURE_OUTCOME_KEY_PREFIX)) {
      await storage.remove(key);
    }
  }
}
