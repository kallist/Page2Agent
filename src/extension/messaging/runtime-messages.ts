/**
 * Runtime message contract — production capture flow (TASK 07).
 *
 * The TASK 02 foundation runtime-check messages were removed: the production
 * capture flow fully replaces them (their validation coverage is superseded by
 * the capture message tests).
 *
 * Every message is a discriminated union, strictly validated from `unknown`.
 * Every response carries the originating captureId.
 */
import { isNormalizedDocument, isPageContext } from "../../core";
import type { NormalizedDocument, PageContext } from "../../core";
import { isCaptureErrorView, isCaptureResult } from "../capture/capture-result";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

export const CAPTURE_REQUEST = "capture.request" as const;
export const CAPTURE_SUCCESS = "capture.success" as const;
export const CAPTURE_FAILURE = "capture.failure" as const;
export const CONTENT_CAPTURE_REQUEST = "content.capture.request" as const;
export const CONTENT_CAPTURE_SUCCESS = "content.capture.success" as const;
export const CONTENT_CAPTURE_FAILURE = "content.capture.failure" as const;

/** Side Panel → Service Worker: capture the current active tab. */
export interface CaptureRequest {
  type: typeof CAPTURE_REQUEST;
  captureId: string;
}

/** Service Worker → Side Panel: capture completed with the final result. */
export interface CaptureSuccess {
  type: typeof CAPTURE_SUCCESS;
  captureId: string;
  result: CaptureResult;
}

/** Service Worker → Side Panel: capture failed (user-safe error). */
export interface CaptureFailure {
  type: typeof CAPTURE_FAILURE;
  captureId: string;
  error: CaptureErrorView;
}

/** Service Worker → Content Script: extract the given page context. */
export interface ContentCaptureRequest {
  type: typeof CONTENT_CAPTURE_REQUEST;
  context: PageContext;
}

/** Content Script → Service Worker: validated NormalizedDocument. */
export interface ContentCaptureSuccess {
  type: typeof CONTENT_CAPTURE_SUCCESS;
  captureId: string;
  document: NormalizedDocument;
}

/** Content Script → Service Worker: safe extraction failure. */
export interface ContentCaptureFailure {
  type: typeof CONTENT_CAPTURE_FAILURE;
  captureId: string;
  error: CaptureErrorView;
}

export type CaptureMessage = CaptureRequest | CaptureSuccess | CaptureFailure;
export type ContentCaptureMessage =
  | ContentCaptureRequest
  | ContentCaptureSuccess
  | ContentCaptureFailure;

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

export function isCaptureRequest(value: unknown): value is CaptureRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId"]) &&
    value.type === CAPTURE_REQUEST &&
    isNonEmptyString(value.captureId)
  );
}

export function isCaptureSuccess(value: unknown): value is CaptureSuccess {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "result"]) &&
    value.type === CAPTURE_SUCCESS &&
    isNonEmptyString(value.captureId) &&
    isCaptureResult(value.result)
  );
}

export function isCaptureFailure(value: unknown): value is CaptureFailure {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "error"]) &&
    value.type === CAPTURE_FAILURE &&
    isNonEmptyString(value.captureId) &&
    isCaptureErrorView(value.error)
  );
}

export function isContentCaptureRequest(value: unknown): value is ContentCaptureRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "context"]) &&
    value.type === CONTENT_CAPTURE_REQUEST &&
    isPageContext(value.context)
  );
}

export function isContentCaptureSuccess(value: unknown): value is ContentCaptureSuccess {
  return (
    isContentCaptureSuccessEnvelope(value) &&
    isNormalizedDocument(value.document)
  );
}

/**
 * Shape-level check for content.capture.success WITHOUT validating the
 * document, so callers can map a malformed document to INVALID_DOCUMENT
 * instead of INVALID_MESSAGE.
 */
export function isContentCaptureSuccessEnvelope(
  value: unknown,
): value is { type: typeof CONTENT_CAPTURE_SUCCESS; captureId: string; document: unknown } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "document"]) &&
    value.type === CONTENT_CAPTURE_SUCCESS &&
    isNonEmptyString(value.captureId)
  );
}

export function isContentCaptureFailure(value: unknown): value is ContentCaptureFailure {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "error"]) &&
    value.type === CONTENT_CAPTURE_FAILURE &&
    isNonEmptyString(value.captureId) &&
    isCaptureErrorView(value.error)
  );
}
