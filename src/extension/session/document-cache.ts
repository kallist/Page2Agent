/**
 * Captured-document session cache (V1.1).
 *
 * One key per browser window holds the latest successfully captured
 * NormalizedDocument so the Side Panel can add the "current capture" to the
 * Context Cart without re-extracting. chrome.storage.session only — page
 * content never survives browser restarts, and only ONE document per window
 * is ever kept (bounded by design, no accumulation of browsing history).
 */
import {
  hasOnlyAllowedKeys,
  isNonEmptyString,
  isRecord,
} from "../../core/validation/primitives";
import { isNormalizedDocument } from "../../core";
import type { NormalizedDocument } from "../../core";
import type { SessionStorage } from "./session-storage";

export const WINDOW_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const WINDOW_DOCUMENT_KEY_PREFIX = "page2agent.window-document.v1.";

export interface WindowDocumentRecord {
  schemaVersion: typeof WINDOW_DOCUMENT_SCHEMA_VERSION;
  captureId: string;
  document: NormalizedDocument;
}

export function windowDocumentKey(windowId: number): string {
  return `${WINDOW_DOCUMENT_KEY_PREFIX}${windowId}`;
}

const RECORD_KEYS = ["schemaVersion", "captureId", "document"];

export function isWindowDocumentRecord(value: unknown): value is WindowDocumentRecord {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, RECORD_KEYS) &&
    value.schemaVersion === WINDOW_DOCUMENT_SCHEMA_VERSION &&
    isNonEmptyString(value.captureId) &&
    isNormalizedDocument(value.document)
  );
}

export async function writeWindowDocument(
  storage: SessionStorage,
  windowId: number,
  record: WindowDocumentRecord,
): Promise<void> {
  await storage.set(windowDocumentKey(windowId), record);
}

/** Latest captured document for a window whose captureId still matches. */
export async function readWindowDocumentForCapture(
  storage: SessionStorage,
  windowId: number,
  captureId: string,
): Promise<NormalizedDocument | null> {
  const raw = await storage.get(windowDocumentKey(windowId));
  if (!isWindowDocumentRecord(raw)) {
    return null;
  }
  if (raw.captureId !== captureId) {
    return null; // stale cache — the caller must never guess another capture
  }
  return raw.document;
}
