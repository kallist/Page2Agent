/**
 * Canonical document model. NormalizedDocument is the single source of truth
 * for captured page content; Markdown and Agent output are only serializations
 * derived from it. It depends on nothing but standard Web types.
 */
import {
  hasOnlyAllowedKeys,
  isIsoDateTimeString,
  isMeaningfulText,
  isOptionalMeaningfulString,
  isOptionalNonEmptyStringArray,
  isPositiveSafeInteger,
  isRecord,
} from "../validation/primitives";
import { isSafeAbsoluteUrl, isSafeLinkUrl } from "../url/normalize-url";

// ---------------------------------------------------------------------------
// SourceDescriptor
// ---------------------------------------------------------------------------

export const WEB_SOURCE_KIND = "web" as const;
export const GITHUB_ISSUE_SOURCE_KIND = "github_issue" as const;
export const GITHUB_PULL_REQUEST_SOURCE_KIND = "github_pull_request" as const;

export interface WebSourceDescriptor {
  kind: typeof WEB_SOURCE_KIND;
  url: string;
  canonicalUrl?: string;
  site?: string;
}

export interface GitHubIssueSourceDescriptor {
  kind: typeof GITHUB_ISSUE_SOURCE_KIND;
  url: string;
  canonicalUrl?: string;
  owner: string;
  repo: string;
  issueNumber: number;
  labels?: string[];
}

/**
 * GitHub Pull Request identity (V1.1). Identity (owner/repo/prNumber) is a
 * source fact derived from the URL. State and branch display names are
 * optional rendered-DOM facts; they are never invented when the DOM does not
 * expose them. The optional strings are display values only, never URLs.
 */
export const GITHUB_PULL_REQUEST_STATES = ["open", "closed", "merged"] as const;
export type GitHubPullRequestState = (typeof GITHUB_PULL_REQUEST_STATES)[number];

export interface GitHubPullRequestSourceDescriptor {
  kind: typeof GITHUB_PULL_REQUEST_SOURCE_KIND;
  url: string;
  canonicalUrl?: string;
  owner: string;
  repo: string;
  prNumber: number;
  labels?: string[];
  state?: GitHubPullRequestState;
  baseBranch?: string;
  headBranch?: string;
}

export type SourceDescriptor =
  | WebSourceDescriptor
  | GitHubIssueSourceDescriptor
  | GitHubPullRequestSourceDescriptor;

const WEB_SOURCE_KEYS = ["kind", "url", "canonicalUrl", "site"];
const GITHUB_ISSUE_SOURCE_KEYS = [
  "kind",
  "url",
  "canonicalUrl",
  "owner",
  "repo",
  "issueNumber",
  "labels",
];
const GITHUB_PULL_REQUEST_SOURCE_KEYS = [
  "kind",
  "url",
  "canonicalUrl",
  "owner",
  "repo",
  "prNumber",
  "labels",
  "state",
  "baseBranch",
  "headBranch",
];

function isOptionalSafeAbsoluteUrl(value: unknown): value is string | undefined {
  return value === undefined || isSafeAbsoluteUrl(value);
}

export function isWebSourceDescriptor(value: unknown): value is WebSourceDescriptor {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, WEB_SOURCE_KEYS) &&
    value.kind === WEB_SOURCE_KIND &&
    isSafeAbsoluteUrl(value.url) &&
    isOptionalSafeAbsoluteUrl(value.canonicalUrl) &&
    isOptionalMeaningfulString(value.site)
  );
}

export function isGitHubIssueSourceDescriptor(
  value: unknown,
): value is GitHubIssueSourceDescriptor {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, GITHUB_ISSUE_SOURCE_KEYS) &&
    value.kind === GITHUB_ISSUE_SOURCE_KIND &&
    isSafeAbsoluteUrl(value.url) &&
    isOptionalSafeAbsoluteUrl(value.canonicalUrl) &&
    isMeaningfulText(value.owner) &&
    isMeaningfulText(value.repo) &&
    isPositiveSafeInteger(value.issueNumber) &&
    isOptionalNonEmptyStringArray(value.labels)
  );
}

export function isGitHubPullRequestState(value: unknown): value is GitHubPullRequestState {
  return (
    typeof value === "string" &&
    (GITHUB_PULL_REQUEST_STATES as readonly string[]).includes(value)
  );
}
export function isGitHubPullRequestSourceDescriptor(
  value: unknown,
): value is GitHubPullRequestSourceDescriptor {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, GITHUB_PULL_REQUEST_SOURCE_KEYS) ||
    value.kind !== GITHUB_PULL_REQUEST_SOURCE_KIND ||
    !isSafeAbsoluteUrl(value.url) ||
    !isOptionalSafeAbsoluteUrl(value.canonicalUrl) ||
    !isMeaningfulText(value.owner) ||
    !isMeaningfulText(value.repo) ||
    !isPositiveSafeInteger(value.prNumber) ||
    !isOptionalNonEmptyStringArray(value.labels) ||
    (value.state !== undefined && !isGitHubPullRequestState(value.state))
  ) {
    return false;
  }
  return (
    isOptionalMeaningfulString(value.baseBranch) &&
    isOptionalMeaningfulString(value.headBranch)
  );
}

export function isSourceDescriptor(value: unknown): value is SourceDescriptor {
  return (
    isWebSourceDescriptor(value) ||
    isGitHubIssueSourceDescriptor(value) ||
    isGitHubPullRequestSourceDescriptor(value)
  );
}

// ---------------------------------------------------------------------------
// DocumentCaptureInfo — how this document was produced (V1.1)
// ---------------------------------------------------------------------------

/**
 * Semantic adapter identities. A document records WHICH adapter produced its
 * blocks so receipts, nutrition labels and recipe suggestions can reason
 * about extraction provenance without re-running detection.
 */
export const DOCUMENT_ADAPTER_IDS = [
  "generic-article",
  "github-issue",
  "github-pull-request",
  "technical-docs",
  "context-lens",
] as const;
export type DocumentAdapterId = (typeof DOCUMENT_ADAPTER_IDS)[number];

export const DOCUMENT_ADAPTER_NAMES: Record<DocumentAdapterId, string> = {
  "generic-article": "Generic Article",
  "github-issue": "GitHub Issue",
  "github-pull-request": "GitHub Pull Request",
  "technical-docs": "Technical Documentation",
  "context-lens": "Context Lens",
};

export interface DocumentAdapterInfo {
  id: DocumentAdapterId;
  /** Human label derived from the id, kept as data for serialization. */
  name: string;
}

/** Capture scope distinguishes full-page captures from picked regions. */
export const DOCUMENT_CAPTURE_SCOPES = [
  "full-page",
  "selection",
  "text-selection",
] as const;
export type DocumentCaptureScope = (typeof DOCUMENT_CAPTURE_SCOPES)[number];

export interface DocumentCaptureInfo {
  adapter: DocumentAdapterInfo;
  scope: DocumentCaptureScope;
}

const ADAPTER_INFO_KEYS = ["id", "name"];
const CAPTURE_INFO_KEYS = ["adapter", "scope"];

function isDocumentAdapterInfo(value: unknown): value is DocumentAdapterInfo {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ADAPTER_INFO_KEYS) &&
    (DOCUMENT_ADAPTER_IDS as readonly string[]).includes(value.id as string) &&
    value.name === DOCUMENT_ADAPTER_NAMES[value.id as DocumentAdapterId]
  );
}

function isDocumentCaptureInfo(value: unknown): value is DocumentCaptureInfo {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, CAPTURE_INFO_KEYS) &&
    isDocumentAdapterInfo(value.adapter) &&
    (DOCUMENT_CAPTURE_SCOPES as readonly string[]).includes(value.scope as string)
  );
}

// ---------------------------------------------------------------------------
// DocumentMetadata
// ---------------------------------------------------------------------------

export interface DocumentMetadata {
  title: string;
  author?: string;
  publishedAt?: string;
  capturedAt: string;
}

const METADATA_KEYS = ["title", "author", "publishedAt", "capturedAt"];

export function isDocumentMetadata(value: unknown): value is DocumentMetadata {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, METADATA_KEYS) &&
    isMeaningfulText(value.title) &&
    isOptionalMeaningfulString(value.author) &&
    (value.publishedAt === undefined || isIsoDateTimeString(value.publishedAt)) &&
    isIsoDateTimeString(value.capturedAt)
  );
}

// ---------------------------------------------------------------------------
// ContentBlock (discriminated union)
// ---------------------------------------------------------------------------

export interface HeadingBlock {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface ParagraphBlock {
  type: "paragraph";
  text: string;
}

export interface CodeBlock {
  type: "code";
  code: string;
  language?: string;
}

export interface QuoteBlock {
  type: "quote";
  text: string;
}

export interface ListBlock {
  type: "list";
  ordered: boolean;
  items: string[];
}

export interface ImageBlock {
  type: "image";
  src: string;
  alt?: string;
  title?: string;
}

export interface LinkBlock {
  type: "link";
  href: string;
  text: string;
}

export interface TableBlock {
  type: "table";
  headers?: string[];
  rows: string[][];
}

export type ContentBlock =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | QuoteBlock
  | ListBlock
  | ImageBlock
  | LinkBlock
  | TableBlock;

const BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "code",
  "quote",
  "list",
  "image",
  "link",
  "table",
]);

function isHeadingLevel(value: unknown): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

export function isHeadingBlock(value: unknown): value is HeadingBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "level", "text"]) &&
    value.type === "heading" &&
    isHeadingLevel(value.level) &&
    isMeaningfulText(value.text)
  );
}

export function isParagraphBlock(value: unknown): value is ParagraphBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "text"]) &&
    value.type === "paragraph" &&
    isMeaningfulText(value.text)
  );
}

export function isCodeBlock(value: unknown): value is CodeBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "code", "language"]) &&
    value.type === "code" &&
    typeof value.code === "string" &&
    value.code.length > 0 && // whitespace/newlines are allowed inside code
    isOptionalMeaningfulString(value.language)
  );
}

export function isQuoteBlock(value: unknown): value is QuoteBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "text"]) &&
    value.type === "quote" &&
    isMeaningfulText(value.text)
  );
}

export function isListBlock(value: unknown): value is ListBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "ordered", "items"]) &&
    value.type === "list" &&
    typeof value.ordered === "boolean" &&
    Array.isArray(value.items) &&
    value.items.length >= 1 &&
    value.items.every(isMeaningfulText)
  );
}

export function isImageBlock(value: unknown): value is ImageBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "src", "alt", "title"]) &&
    value.type === "image" &&
    isSafeAbsoluteUrl(value.src) &&
    isOptionalMeaningfulString(value.alt) &&
    isOptionalMeaningfulString(value.title)
  );
}

export function isLinkBlock(value: unknown): value is LinkBlock {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["type", "href", "text"]) &&
    value.type === "link" &&
    isSafeLinkUrl(value.href) &&
    isMeaningfulText(value.text)
  );
}

export function isTableBlock(value: unknown): value is TableBlock {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, ["type", "headers", "rows"]) ||
    value.type !== "table" ||
    !Array.isArray(value.rows) ||
    value.rows.length < 1
  ) {
    return false;
  }
  const firstRow = value.rows[0];
  if (!Array.isArray(firstRow) || !firstRow.every((cell) => typeof cell === "string")) {
    return false;
  }
  const firstRowLength = firstRow.length;
  for (const row of value.rows) {
    if (
      !Array.isArray(row) ||
      row.length !== firstRowLength ||
      !row.every((cell) => typeof cell === "string")
    ) {
      return false;
    }
  }
  if (value.headers === undefined) {
    return true;
  }
  return (
    Array.isArray(value.headers) &&
    value.headers.length === firstRowLength &&
    value.headers.every((header) => typeof header === "string")
  );
}

export function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value) || typeof value.type !== "string" || !BLOCK_TYPES.has(value.type)) {
    return false;
  }
  switch (value.type) {
    case "heading":
      return isHeadingBlock(value);
    case "paragraph":
      return isParagraphBlock(value);
    case "code":
      return isCodeBlock(value);
    case "quote":
      return isQuoteBlock(value);
    case "list":
      return isListBlock(value);
    case "image":
      return isImageBlock(value);
    case "link":
      return isLinkBlock(value);
    case "table":
      return isTableBlock(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

/**
 * Image assets are context references only in V0.1: absolute URL + alt +
 * optional title. No download, Base64 persistence, OCR, or upload.
 */
export interface ImageAsset {
  kind: "image";
  url: string;
  alt?: string;
  title?: string;
}

export type Asset = ImageAsset;

export function isAsset(value: unknown): value is Asset {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["kind", "url", "alt", "title"]) &&
    value.kind === "image" &&
    isSafeAbsoluteUrl(value.url) &&
    isOptionalMeaningfulString(value.alt) &&
    isOptionalMeaningfulString(value.title)
  );
}

/**
 * Deduplicated asset index derived from the document's blocks. ImageBlock
 * represents position in the content flow; Asset is the reference collection.
 * First-seen order is preserved; duplicate URLs are emitted once.
 * Pure: never mutates the input.
 */
export function collectAssetsFromBlocks(blocks: readonly ContentBlock[]): Asset[] {
  const assets: Asset[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "image" || seen.has(block.src)) {
      continue;
    }
    seen.add(block.src);
    const asset: ImageAsset = { kind: "image", url: block.src };
    if (block.alt !== undefined) {
      asset.alt = block.alt;
    }
    if (block.title !== undefined) {
      asset.title = block.title;
    }
    assets.push(asset);
  }
  return assets;
}

// ---------------------------------------------------------------------------
// NormalizedDocument
// ---------------------------------------------------------------------------

export const NORMALIZED_DOCUMENT_SCHEMA_VERSION = 1 as const;

export interface NormalizedDocument {
  schemaVersion: typeof NORMALIZED_DOCUMENT_SCHEMA_VERSION;
  source: SourceDescriptor;
  metadata: DocumentMetadata;
  blocks: ContentBlock[];
  assets: Asset[];
  /**
   * V1.1: optional production provenance. Absent on legacy documents; every
   * current adapter writes it. Optionality keeps V1.0 session data readable.
   */
  capture?: DocumentCaptureInfo;
}

const DOCUMENT_KEYS = ["schemaVersion", "source", "metadata", "blocks", "assets", "capture"];

export function isNormalizedDocument(value: unknown): value is NormalizedDocument {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, DOCUMENT_KEYS)) {
    return false;
  }
  return (
    value.schemaVersion === NORMALIZED_DOCUMENT_SCHEMA_VERSION &&
    isSourceDescriptor(value.source) &&
    isDocumentMetadata(value.metadata) &&
    Array.isArray(value.blocks) &&
    value.blocks.length >= 1 && // no-content documents must fail, not be guessed at
    value.blocks.every(isContentBlock) &&
    Array.isArray(value.assets) &&
    value.assets.every(isAsset) &&
    (value.capture === undefined || isDocumentCaptureInfo(value.capture))
  );
}
