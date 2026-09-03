/**
 * ContextSource — one cart-able unit of context (V1.1).
 *
 * A ContextSource is a captured, user-curated piece of the web: a full page,
 * picked sections (Context Lens), or a plain text selection. The canonical
 * payload is a NormalizedDocument (Source facts + blocks). Role, primary
 * flag, and the cart arrangement are USER choices and are stored separately
 * from the document — source facts are never rewritten by choices.
 */
import {
  hasOnlyAllowedKeys,
  isMeaningfulText,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
} from "../validation/primitives";
import { isNormalizedDocument } from "../types/document";
import type {
  DocumentAdapterInfo,
  DocumentCaptureScope,
  NormalizedDocument,
  SourceDescriptor,
} from "../types/document";

export const CONTEXT_ROLES = ["task", "reference", "evidence", "example", "selection"] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

export interface ContextSelectionDetail {
  /** Number of regions/text ranges combined into this one source. */
  regions: number;
  /** Deterministic labels (headings / "User text selection") for receipts. */
  labels: string[];
}

export interface ContextSourceItem {
  /**
   * Local cart instance id — stable for React keys, reorder, role updates.
   */
  id: string;
  /**
   * Provenance: capture correlation id + captured URL + capture timestamp.
   * captureId ties a cart item to the exact capture session that produced it.
   */
  captureId: string;
  url: string;
  capturedAt: string;
  /** Title chosen for this context source (document title or region label). */
  title: string;
  /** Semantic source kind of the underlying page. */
  sourceKind: SourceDescriptor["kind"];
  /**
   * Adapter that produced this item's blocks (identity from the document
   * when available). Absent only for pre-V1.1 session data — never guessed.
   */
  adapter?: DocumentAdapterInfo;
  scope: DocumentCaptureScope;
  /** What the user selected on the page (absent for full-page captures). */
  selection?: ContextSelectionDetail;
  role: ContextRole;
  /** At most one item per cart is primary (cart ops enforce the invariant). */
  primary: boolean;
  /** Canonical content. Never Markdown; never raw HTML. */
  document: NormalizedDocument;
}

const SELECTION_DETAIL_KEYS = ["regions", "labels"];
const ITEM_KEYS = [
  "id",
  "captureId",
  "url",
  "capturedAt",
  "title",
  "sourceKind",
  "adapter",
  "scope",
  "selection",
  "role",
  "primary",
  "document",
];

const CAPTURE_SCOPES: readonly string[] = ["full-page", "selection", "text-selection"];

export function isContextRole(value: unknown): value is ContextRole {
  return typeof value === "string" && (CONTEXT_ROLES as readonly string[]).includes(value);
}

function isDocumentCaptureScope(value: unknown): value is DocumentCaptureScope {
  return typeof value === "string" && CAPTURE_SCOPES.includes(value);
}
function isContextSelectionDetail(value: unknown): value is ContextSelectionDetail {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, SELECTION_DETAIL_KEYS) &&
    isPositiveSafeInteger(value.regions) &&
    Array.isArray(value.labels) &&
    value.labels.every(isMeaningfulText)
  );
}

function isDocumentAdapterInfo(value: unknown): value is DocumentAdapterInfo {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["id", "name"]) &&
    isMeaningfulText(value.id) &&
    isMeaningfulText(value.name)
  );
}

export function isContextSourceItem(value: unknown): value is ContextSourceItem {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, ITEM_KEYS) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.captureId) ||
    !isMeaningfulText(value.url) ||
    !isMeaningfulText(value.capturedAt) ||
    !isMeaningfulText(value.title) ||
    !isSourceDescriptorKind(value.sourceKind) ||
    !isDocumentCaptureScope(value.scope) ||
    !isContextRole(value.role) ||
    typeof value.primary !== "boolean" ||
    (value.adapter !== undefined && !isDocumentAdapterInfo(value.adapter)) ||
    (value.selection !== undefined && !isContextSelectionDetail(value.selection))
  ) {
    return false;
  }
  if (value.scope !== "full-page" && value.selection === undefined) {
    return false; // a picked/selected source must record what was picked
  }
  return isNormalizedDocument(value.document);
}

function isSourceDescriptorKind(value: unknown): value is SourceDescriptor["kind"] {
  return (
    typeof value === "string" &&
    (value === "web" || value === "github_issue" || value === "github_pull_request")
  );
}

/**
 * Canonical dedupe identity. Full-page sources match on (kind + url) so
 * re-capturing the same page cannot silently stack copies; picked sources
 * match on (captureId + scope + selection labels) because one pick session
 * is one unit even when the page changed between captures.
 */
export function contextSourceDedupeKey(item: ContextSourceItem): string {
  if (item.scope === "full-page") {
    return `full-page|${item.sourceKind}|${item.url}`;
  }
  const labels = (item.selection?.labels ?? []).join("\u0001");
  return `${item.scope}|${item.captureId}|${item.url}|${labels}`;
}

/** New instance id for a cart item (random UUID — never part of content). */
export function createContextSourceId(): string {
  return crypto.randomUUID();
}

export interface ContextSourceSummary {
  id: string;
  title: string;
  url: string;
  sourceKind: SourceDescriptor["kind"];
  role: ContextRole;
  primary: boolean;
  scope: DocumentCaptureScope;
  capturedAt: string;
}

export function summarizeContextSource(item: ContextSourceItem): ContextSourceSummary {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceKind: item.sourceKind,
    role: item.role,
    primary: item.primary,
    scope: item.scope,
    capturedAt: item.capturedAt,
  };
}
