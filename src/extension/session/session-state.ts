/**
 * Capture session state — extension-owned, chrome.storage.session only.
 * Versioned; validated from `unknown` on every read (schema drift, partial
 * writes, extension updates).
 */
import { isCaptureErrorView, isCaptureResult } from "../capture/capture-result";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

export const CAPTURE_SESSION_SCHEMA_VERSION = 1 as const;
export const CAPTURE_SESSION_KEY = "page2agent.capture.v1";

export type CaptureSessionState =
  | {
      schemaVersion: typeof CAPTURE_SESSION_SCHEMA_VERSION;
      status: "capturing";
      captureId: string;
      startedAt: string;
    }
  | {
      schemaVersion: typeof CAPTURE_SESSION_SCHEMA_VERSION;
      status: "captured";
      captureId: string;
      result: CaptureResult;
    }
  | {
      schemaVersion: typeof CAPTURE_SESSION_SCHEMA_VERSION;
      status: "error";
      captureId: string;
      error: CaptureErrorView;
    };

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

export function isCaptureSessionState(value: unknown): value is CaptureSessionState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CAPTURE_SESSION_SCHEMA_VERSION ||
    !isNonEmptyString(value.captureId)
  ) {
    return false;
  }
  switch (value.status) {
    case "capturing":
      return (
        hasOnlyKeys(value, ["schemaVersion", "status", "captureId", "startedAt"]) &&
        isNonEmptyString(value.startedAt)
      );
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
