import {
  hasOnlyAllowedKeys,
  isIsoDateTimeString,
  isMeaningfulText,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
} from "../validation/primitives";

const PAGE_CONTEXT_KEYS = ["captureId", "tabId", "url", "title", "capturedAt"] as const;

/**
 * Runtime context of one browser capture.
 *
 * Browser-runtime fields (tabId, captureId) belong HERE, not in the long-lived
 * document source model: NormalizedDocument must be able to outlive the tab
 * lifecycle.
 */
export interface PageContext {
  captureId: string;
  tabId: number;
  url: string;
  title: string;
  capturedAt: string;
}

export function isPageContext(value: unknown): value is PageContext {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, PAGE_CONTEXT_KEYS)) {
    return false;
  }
  return (
    isNonEmptyString(value.captureId) &&
    isNonNegativeSafeInteger(value.tabId) &&
    isNonEmptyString(value.url) &&
    isMeaningfulText(value.title) &&
    isIsoDateTimeString(value.capturedAt)
  );
}

/**
 * Capture correlation ID helper. This is NOT the future capture orchestration
 * itself; it only produces a non-empty unique id (UUID).
 */
export function createCaptureId(): string {
  return crypto.randomUUID();
}
