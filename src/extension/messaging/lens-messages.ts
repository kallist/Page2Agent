/**
 * Context Lens runtime messages (V1.1).
 *
 * Flow: Side Panel → Service Worker (router) → Content Script → back.
 * The content script also broadcasts live `lens.state.event` updates so the
 * panel can mirror inclusion counts without polling.
 *
 * Every message is a discriminated union validated from `unknown`; every
 * response echoes its captureId. Materialization payloads carry validated
 * NormalizedDocuments only — never DOM or raw HTML.
 */
import { isNormalizedDocument } from "../../core";
import type { NormalizedDocument } from "../../core";
import { isCaptureErrorView } from "../capture/capture-result";
import type { CaptureErrorView } from "../capture/capture-result";

export const LENS_ENTER_REQUEST = "lens.enter.request" as const;
export const LENS_ENTER_RESPONSE = "lens.enter.response" as const;
export const LENS_QUERY_REQUEST = "lens.query.request" as const;
export const LENS_QUERY_RESPONSE = "lens.query.response" as const;
export const LENS_MATERIALIZE_REQUEST = "lens.materialize.request" as const;
export const LENS_MATERIALIZE_RESPONSE = "lens.materialize.response" as const;
export const LENS_STATE_EVENT = "lens.state.event" as const;
export const LENS_CLEAR_REQUEST = "lens.clear.request" as const;
export const LENS_CLEAR_RESPONSE = "lens.clear.response" as const;
export const LENS_SELECTION_PROBE_REQUEST = "lens.selection.probe.request" as const;
export const LENS_SELECTION_PROBE_RESPONSE = "lens.selection.probe.response" as const;
export const LENS_SELECTION_CAPTURE_REQUEST = "lens.selection.capture.request" as const;
export const LENS_SELECTION_CAPTURE_RESPONSE = "lens.selection.capture.response" as const;

export interface LensSessionRef {
  captureId: string;
  url: string;
  title: string;
  capturedAt: string;
}

export interface LensSnapshot {
  active: boolean;
  selectedCount: number;
  estimatedTokens: number;
}

export interface LensRegionMeta {
  label: string;
  tokens: number;
  characters: number;
}

export interface LensMaterializationPayload {
  document: NormalizedDocument;
  regions: LensRegionMeta[];
}

export interface LensEnterRequest {
  type: typeof LENS_ENTER_REQUEST;
  tabId: number;
  session: LensSessionRef;
}

export interface LensQueryRequest {
  type: typeof LENS_QUERY_REQUEST;
  tabId: number;
  captureId: string;
}

export interface LensMaterializeRequest {
  type: typeof LENS_MATERIALIZE_REQUEST;
  tabId: number;
  session: LensSessionRef;
}

export interface LensClearRequest {
  type: typeof LENS_CLEAR_REQUEST;
  tabId: number;
  captureId: string;
}

export interface LensSelectionProbeRequest {
  type: typeof LENS_SELECTION_PROBE_REQUEST;
  tabId: number;
  session: LensSessionRef;
}

export interface LensSelectionCaptureRequest {
  type: typeof LENS_SELECTION_CAPTURE_REQUEST;
  tabId: number;
  session: LensSessionRef;
}

export type LensRoutedRequest =
  | LensEnterRequest
  | LensQueryRequest
  | LensMaterializeRequest
  | LensClearRequest
  | LensSelectionProbeRequest
  | LensSelectionCaptureRequest;

export interface LensEnterResponse {
  type: typeof LENS_ENTER_RESPONSE;
  captureId: string;
  ok: boolean;
  snapshot?: LensSnapshot;
  error?: CaptureErrorView;
}

export interface LensQueryResponse {
  type: typeof LENS_QUERY_RESPONSE;
  captureId: string;
  ok: boolean;
  snapshot?: LensSnapshot;
  error?: CaptureErrorView;
}

export interface LensMaterializeResponse {
  type: typeof LENS_MATERIALIZE_RESPONSE;
  captureId: string;
  ok: boolean;
  /** null when nothing is picked yet (UI shows the hint instead of an error). */
  materialization?: LensMaterializationPayload;
  error?: CaptureErrorView;
}

export interface LensStateEvent {
  type: typeof LENS_STATE_EVENT;
  captureId: string;
  snapshot: LensSnapshot;
}

export interface LensClearResponse {
  type: typeof LENS_CLEAR_RESPONSE;
  captureId: string;
  ok: boolean;
  error?: CaptureErrorView;
}

export interface LensSelectionProbeResponse {
  type: typeof LENS_SELECTION_PROBE_RESPONSE;
  captureId: string;
  ok: boolean;
  hasSelection?: boolean;
  error?: CaptureErrorView;
}

export interface LensSelectionCaptureResponse {
  type: typeof LENS_SELECTION_CAPTURE_RESPONSE;
  captureId: string;
  ok: boolean;
  document?: NormalizedDocument;
  /** Short excerpt of the captured selection (UI + cart labels). */
  excerpt?: string;
  error?: CaptureErrorView;
}

export type LensMessage =
  | LensEnterRequest
  | LensQueryRequest
  | LensMaterializeRequest
  | LensClearRequest
  | LensSelectionProbeRequest
  | LensSelectionCaptureRequest
  | LensEnterResponse
  | LensQueryResponse
  | LensMaterializeResponse
  | LensClearResponse
  | LensSelectionProbeResponse
  | LensSelectionCaptureResponse
  | LensStateEvent;

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

function isTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLensSnapshot(value: unknown): value is LensSnapshot {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["active", "selectedCount", "estimatedTokens"]) &&
    typeof value.active === "boolean" &&
    isNonNegativeInteger(value.selectedCount) &&
    isNonNegativeInteger(value.estimatedTokens)
  );
}

function isLensRegionMeta(value: unknown): value is LensRegionMeta {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["label", "tokens", "characters"]) &&
    isNonEmptyString(value.label) &&
    isNonNegativeInteger(value.tokens) &&
    isNonNegativeInteger(value.characters)
  );
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isLensSessionRef(value: unknown): value is LensSessionRef {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["captureId", "url", "title", "capturedAt"]) &&
    isNonEmptyString(value.captureId) &&
    isNonEmptyString(value.url) &&
    typeof value.title === "string" &&
    isNonEmptyString(value.capturedAt)
  );
}

export function isLensEnterRequest(value: unknown): value is LensEnterRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "session"]) &&
    value.type === LENS_ENTER_REQUEST &&
    isTabId(value.tabId) &&
    isLensSessionRef(value.session)
  );
}

export function isLensQueryRequest(value: unknown): value is LensQueryRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "captureId"]) &&
    value.type === LENS_QUERY_REQUEST &&
    isTabId(value.tabId) &&
    isNonEmptyString(value.captureId)
  );
}

export function isLensMaterializeRequest(value: unknown): value is LensMaterializeRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "session"]) &&
    value.type === LENS_MATERIALIZE_REQUEST &&
    isTabId(value.tabId) &&
    isLensSessionRef(value.session)
  );
}

export function isLensClearRequest(value: unknown): value is LensClearRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "captureId"]) &&
    value.type === LENS_CLEAR_REQUEST &&
    isTabId(value.tabId) &&
    isNonEmptyString(value.captureId)
  );
}

export function isLensSelectionProbeRequest(value: unknown): value is LensSelectionProbeRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "session"]) &&
    value.type === LENS_SELECTION_PROBE_REQUEST &&
    isTabId(value.tabId) &&
    isLensSessionRef(value.session)
  );
}

export function isLensSelectionCaptureRequest(
  value: unknown,
): value is LensSelectionCaptureRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "session"]) &&
    value.type === LENS_SELECTION_CAPTURE_REQUEST &&
    isTabId(value.tabId) &&
    isLensSessionRef(value.session)
  );
}

export function isLensRoutedRequest(value: unknown): value is LensRoutedRequest {
  return (
    isLensEnterRequest(value) ||
    isLensQueryRequest(value) ||
    isLensMaterializeRequest(value) ||
    isLensClearRequest(value) ||
    isLensSelectionProbeRequest(value) ||
    isLensSelectionCaptureRequest(value)
  );
}

function isLensMaterializationPayload(value: unknown): value is LensMaterializationPayload {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["document", "regions"]) &&
    isNormalizedDocument(value.document) &&
    Array.isArray(value.regions) &&
    value.regions.every(isLensRegionMeta)
  );
}

function isErrorField(value: unknown): value is CaptureErrorView {
  return isCaptureErrorView(value);
}

export function isLensEnterResponse(value: unknown): value is LensEnterResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "ok", "snapshot", "error"]) &&
    value.type === LENS_ENTER_RESPONSE &&
    isNonEmptyString(value.captureId) &&
    typeof value.ok === "boolean" &&
    (value.snapshot === undefined || isLensSnapshot(value.snapshot)) &&
    (value.error === undefined || isErrorField(value.error))
  );
}

export function isLensQueryResponse(value: unknown): value is LensQueryResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "ok", "snapshot", "error"]) &&
    value.type === LENS_QUERY_RESPONSE &&
    isNonEmptyString(value.captureId) &&
    typeof value.ok === "boolean" &&
    (value.snapshot === undefined || isLensSnapshot(value.snapshot)) &&
    (value.error === undefined || isErrorField(value.error))
  );
}

export function isLensMaterializeResponse(value: unknown): value is LensMaterializeResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "ok", "materialization", "error"]) &&
    value.type === LENS_MATERIALIZE_RESPONSE &&
    isNonEmptyString(value.captureId) &&
    typeof value.ok === "boolean" &&
    (value.materialization === undefined ||
      value.materialization === null ||
      isLensMaterializationPayload(value.materialization)) &&
    (value.error === undefined || isErrorField(value.error))
  );
}

export function isLensStateEvent(value: unknown): value is LensStateEvent {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "snapshot"]) &&
    value.type === LENS_STATE_EVENT &&
    isNonEmptyString(value.captureId) &&
    isLensSnapshot(value.snapshot)
  );
}

export function isLensClearResponse(value: unknown): value is LensClearResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "ok", "error"]) &&
    value.type === LENS_CLEAR_RESPONSE &&
    isNonEmptyString(value.captureId) &&
    typeof value.ok === "boolean" &&
    (value.error === undefined || isErrorField(value.error))
  );
}

export function isLensSelectionProbeResponse(
  value: unknown,
): value is LensSelectionProbeResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "ok", "hasSelection", "error"]) &&
    value.type === LENS_SELECTION_PROBE_RESPONSE &&
    isNonEmptyString(value.captureId) &&
    typeof value.ok === "boolean" &&
    (value.hasSelection === undefined || typeof value.hasSelection === "boolean") &&
    (value.error === undefined || isErrorField(value.error))
  );
}

export function isLensSelectionCaptureResponse(
  value: unknown,
): value is LensSelectionCaptureResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "captureId", "ok", "document", "excerpt", "error"]) &&
    value.type === LENS_SELECTION_CAPTURE_RESPONSE &&
    isNonEmptyString(value.captureId) &&
    typeof value.ok === "boolean" &&
    (value.document === undefined || isNormalizedDocument(value.document)) &&
    (value.excerpt === undefined || typeof value.excerpt === "string") &&
    (value.error === undefined || isErrorField(value.error))
  );
}
