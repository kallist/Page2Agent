/**
 * CaptureResult — the extension delivery DTO crossing Service Worker → Side
 * Panel and chrome.storage.session. Contains only final derived strings and
 * metadata; never raw HTML, never the full NormalizedDocument.
 */
import { Page2AgentError, Page2AgentErrorCode, userSafeMessage } from "../../core";
import type { Page2AgentErrorCode as ErrorCode } from "../../core";

export const CAPTURE_RESULT_SCHEMA_VERSION = 1 as const;

export type SourceKind = "web" | "github_issue";
export type ActionKind = "use_as_context" | "fix_issue";

export interface CaptureResult {
  schemaVersion: typeof CAPTURE_RESULT_SCHEMA_VERSION;
  captureId: string;
  tabId: number;
  url: string;
  capturedAt: string;
  sourceKind: SourceKind;
  title: string;
  actionKind: ActionKind;
  stats: {
    characters: number;
    codeBlocks: number;
    links: number;
  };
  markdown: string;
  agentContext: string;
  filename: string;
}

/** User-safe, serializable error view (no stack, no cause). */
export interface CaptureErrorView {
  code: ErrorCode;
  message: string;
}

const RESULT_KEYS = [
  "schemaVersion",
  "captureId",
  "tabId",
  "url",
  "capturedAt",
  "sourceKind",
  "title",
  "actionKind",
  "stats",
  "markdown",
  "agentContext",
  "filename",
] as const;

const STATS_KEYS = ["characters", "codeBlocks", "links"] as const;

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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isCaptureErrorView(value: unknown): value is CaptureErrorView {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["code", "message"]) &&
    isNonEmptyString(value.code) &&
    isNonEmptyString(value.message)
  );
}

export function isCaptureResult(value: unknown): value is CaptureResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RESULT_KEYS) ||
    value.schemaVersion !== CAPTURE_RESULT_SCHEMA_VERSION ||
    !isNonEmptyString(value.captureId) ||
    !isNonNegativeSafeInteger(value.tabId) ||
    !isNonEmptyString(value.url) ||
    !isNonEmptyString(value.capturedAt) ||
    (value.sourceKind !== "web" && value.sourceKind !== "github_issue") ||
    !isNonEmptyString(value.title) ||
    (value.actionKind !== "use_as_context" && value.actionKind !== "fix_issue") ||
    !isRecord(value.stats) ||
    !hasOnlyKeys(value.stats, STATS_KEYS) ||
    !isNonNegativeSafeInteger(value.stats.characters) ||
    !isNonNegativeSafeInteger(value.stats.codeBlocks) ||
    !isNonNegativeSafeInteger(value.stats.links) ||
    typeof value.markdown !== "string" ||
    typeof value.agentContext !== "string" ||
    !isNonEmptyString(value.filename)
  ) {
    return false;
  }
  return true;
}

/**
 * Convert any thrown value into a serializable CaptureErrorView.
 * Page2AgentError keeps its code + safe message; everything else becomes
 * CAPTURE_FAILED with the safe default message (never browser internals).
 */
export function toCaptureErrorView(error: unknown): CaptureErrorView {
  if (error instanceof Page2AgentError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: Page2AgentErrorCode.CAPTURE_FAILED,
    message: userSafeMessage(Page2AgentErrorCode.CAPTURE_FAILED),
  };
}
