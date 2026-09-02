/**
 * Capture session model — extension-owned, chrome.storage.session only.
 *
 * Ownership model (TASK 08 hardening):
 * - `LatestCaptureIntent` lives under one key per browser window and is
 *   written by the Service Worker's toolbar-action controller (the action
 *   click order is the source of truth). Capture workers write only outcomes,
 *   so a stale capture can never revert the latest intent or cross a window.
 * - `CaptureOutcome` lives under a per-capture key and is written ONLY by the
 *   Service Worker handling that capture. Per-capture keys never collide, so
 *   no compare-and-swap is needed and no TOCTOU window exists.
 *
 * Correctness never depends on cleanup; cleanup is hygiene only.
 */
import { isCaptureErrorView, isCaptureResult } from "../capture/capture-result";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

export const CAPTURE_SCHEMA_VERSION = 1 as const;

export const LATEST_CAPTURE_KEY_PREFIX = "page2agent.latest-capture.v1.";
export const CAPTURE_OUTCOME_KEY_PREFIX = "page2agent.capture-result.v1.";

/** One latest-intent namespace per browser window (global Side Panel scope). */
export function latestCaptureIntentKey(windowId: number): string {
  return `${LATEST_CAPTURE_KEY_PREFIX}${windowId}`;
}

/** How old an intent may be before restore treats it as interrupted. */
export const CAPTURE_STALE_AFTER_MS = 120_000;

export interface LatestCaptureIntent {
  schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
  captureId: string;
  startedAt: string;
}

export type CaptureOutcome =
  | {
      schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
      status: "captured";
      captureId: string;
      result: CaptureResult;
    }
  | {
      schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
      status: "error";
      captureId: string;
      error: CaptureErrorView;
    };

export function captureOutcomeKey(captureId: string): string {
  return `${CAPTURE_OUTCOME_KEY_PREFIX}${captureId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isLatestCaptureIntent(value: unknown): value is LatestCaptureIntent {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["schemaVersion", "captureId", "startedAt"]) &&
    value.schemaVersion === CAPTURE_SCHEMA_VERSION &&
    isNonEmptyString(value.captureId) &&
    isNonEmptyString(value.startedAt)
  );
}

export function isCaptureOutcome(value: unknown): value is CaptureOutcome {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CAPTURE_SCHEMA_VERSION ||
    !isNonEmptyString(value.captureId)
  ) {
    return false;
  }
  switch (value.status) {
    case "captured":
      return (
        hasOnlyKeys(value, ["schemaVersion", "status", "captureId", "result"]) &&
        isCaptureResult(value.result)
      );
    case "error":
      return (
        hasOnlyKeys(value, ["schemaVersion", "status", "captureId", "error"]) &&
        isCaptureErrorView(value.error)
      );
    default:
      return false;
  }
}

/** Pure staleness check (no timers; evaluated at restore/state read time). */
export function isCaptureIntentStale(
  intent: LatestCaptureIntent,
  nowIso: string,
): boolean {
  const started = Date.parse(intent.startedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(started) || Number.isNaN(now)) {
    return true; // unparseable timestamps are treated as stale
  }
  return now - started > CAPTURE_STALE_AFTER_MS;
}
