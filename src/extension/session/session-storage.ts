/**
 * chrome.storage.session access with compare-before-write commit helpers.
 *
 * Latest-capture-wins protocol:
 *  1. Side Panel writes { status: "capturing", captureId } BEFORE sending the
 *     capture request — the user click order is the source of truth.
 *  2. Service Worker commits a result/error only if the session still shows
 *     "capturing" for the SAME captureId. Stale completions never overwrite.
 */
import { CAPTURE_SESSION_KEY, isCaptureSessionState } from "./session-state";
import type { CaptureSessionState } from "./session-state";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

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

/** Read + validate the capture session; invalid/absent → null (never crash). */
export async function readCaptureSession(
  storage: SessionStorage,
): Promise<CaptureSessionState | null> {
  const raw = await storage.get(CAPTURE_SESSION_KEY);
  return isCaptureSessionState(raw) ? raw : null;
}

/** Side Panel: mark the newest capture request as capturing. */
export async function writeCapturingState(
  storage: SessionStorage,
  captureId: string,
  startedAt: string,
): Promise<void> {
  const state: CaptureSessionState = {
    schemaVersion: 1,
    status: "capturing",
    captureId,
    startedAt,
  };
  await storage.set(CAPTURE_SESSION_KEY, state);
}

/** Commit a successful result only when this capture is still the latest. */
export async function commitCaptureResultIfCurrent(
  storage: SessionStorage,
  captureId: string,
  result: CaptureResult,
): Promise<boolean> {
  const current = await readCaptureSession(storage);
  if (current?.status !== "capturing" || current.captureId !== captureId) {
    return false;
  }
  const state: CaptureSessionState = {
    schemaVersion: 1,
    status: "captured",
    captureId,
    result,
  };
  await storage.set(CAPTURE_SESSION_KEY, state);
  return true;
}

/** Commit an error only when this capture is still the latest. */
export async function commitCaptureErrorIfCurrent(
  storage: SessionStorage,
  captureId: string,
  error: CaptureErrorView,
): Promise<boolean> {
  const current = await readCaptureSession(storage);
  if (current?.status !== "capturing" || current.captureId !== captureId) {
    return false;
  }
  const state: CaptureSessionState = {
    schemaVersion: 1,
    status: "error",
    captureId,
    error,
  };
  await storage.set(CAPTURE_SESSION_KEY, state);
  return true;
}
