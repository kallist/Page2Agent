/**
 * GitHubIssueExtractor — Page2Agent's GitHub Issue adapter (V0.1 showcase).
 *
 * Pipeline:
 *   PageContext URL → issue identity → issue DOM region → cloned body subtree
 *   → semantic blocks → GitHubIssue SourceDescriptor → NormalizedDocument
 *   → domain validation → size policy.
 *
 * Invariants:
 * - Identity (owner/repo/issueNumber) comes ONLY from the PageContext URL.
 * - No Readability, no GitHub API, no network, no token, no DOM mutation.
 * - Source facts only; no generated instructions, no AgentTask construction.
 */
import {
  collectAssetsFromBlocks,
  isNormalizedDocument,
  isWithinDocumentLimit,
  normalizeLinkUrl,
  Page2AgentError,
  Page2AgentErrorCode,
} from "../../core";
import type {
  DocumentMetadata,
  ExtractionInput,
  GitHubIssueSourceDescriptor,
  NormalizedDocument,
  PageContext,
  PageExtractor,
} from "../../core";
import { normalizeInlineText } from "../../shared/dom/text";
import { extractIssueBodyBlocks, isBodyTextEmpty } from "./github-issue-body";
import {
  EMPTY_BODY_SENTINEL_TEXT,
  firstMatch,
  ISSUE_AUTHOR_SELECTORS,
  ISSUE_BODY_SELECTORS,
  ISSUE_CREATED_TIME_SELECTORS,
  ISSUE_LABELS_CONTAINER_SELECTOR,
  ISSUE_TITLE_SELECTORS,
} from "./github-issue-selectors";
import { parseGitHubIssueUrl } from "./github-issue-url";
import type { GitHubIssueIdentity } from "./github-issue-url";

export class GitHubIssueExtractor implements PageExtractor {
  readonly id = "github-issue";

  /** URL-only, cheap, deterministic detection. */
  canHandle(context: PageContext): boolean {
    return parseGitHubIssueUrl(context.url) !== null;
  }

  async extract(input: ExtractionInput): Promise<NormalizedDocument> {
    const { context, document: sourceDocument } = input;

    // 1. Identity from the PageContext URL (source of truth).
    const identity = parseGitHubIssueUrl(context.url);
    if (identity === null) {
      throw new Page2AgentError(Page2AgentErrorCode.UNSUPPORTED_PAGE);
    }

    // 2. Issue title from the issue-specific region, with a deterministic
    //    identity fallback (never a fabricated task intent).
    const titleElement = firstMatch(sourceDocument, ISSUE_TITLE_SELECTORS);
    const titleText =
      titleElement === null ? "" : normalizeInlineText(titleElement.textContent ?? "");
    const metadataTitle =
      titleText || `${identity.owner}/${identity.repo} issue #${identity.issueNumber}`;

    // 3. Primary issue body (first js-comment-body — comments come later and
    //    are never included).
    const bodyRoot = firstMatch(sourceDocument, ISSUE_BODY_SELECTORS);
    if (bodyRoot === null || isBodyTextEmpty(bodyRoot)) {
      throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
    }
    const blocks = extractIssueBodyBlocks(bodyRoot, context.url);
    if (blocks.length === 0 || isNoDescriptionSentinelOnly(blocks)) {
      throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
    }

    // 4. Optional source facts (never fatal when missing or malformed).
    const labels = extractLabels(sourceDocument);
    const canonicalUrl = resolveCanonicalUrl(sourceDocument, identity);
    const author = resolveAuthor(sourceDocument);
    const publishedAt = resolvePublishedAt(sourceDocument);

    // 5. Metadata — capturedAt comes verbatim from PageContext.
    const metadata: DocumentMetadata = { title: metadataTitle, capturedAt: context.capturedAt };
    if (author !== undefined) {
      metadata.author = author;
    }
    if (publishedAt !== undefined) {
      metadata.publishedAt = publishedAt;
    }

    // 6. Source descriptor.
    const sourceUrl = normalizeLinkUrl(context.url);
    if (sourceUrl === null) {
      throw new Page2AgentError(Page2AgentErrorCode.UNSUPPORTED_PAGE);
    }
    const source: GitHubIssueSourceDescriptor = {
      kind: "github_issue",
      url: sourceUrl,
      owner: identity.owner,
      repo: identity.repo,
      issueNumber: identity.issueNumber,
    };
    if (canonicalUrl !== undefined) {
      source.canonicalUrl = canonicalUrl;
    }
    if (labels.length > 0) {
      source.labels = labels;
    }

    // 7. Build + validate the canonical document.
    const document: NormalizedDocument = {
      schemaVersion: 1,
      source,
      metadata,
      blocks,
      assets: collectAssetsFromBlocks(blocks),
    };
    if (!isNormalizedDocument(document)) {
      throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT);
    }

    // 8. Size policy — hard limit, no silent truncation.
    if (!isWithinDocumentLimit(document)) {
      throw new Page2AgentError(Page2AgentErrorCode.CONTENT_TOO_LARGE);
    }

    return document;
  }
}

function extractLabels(sourceDocument: Document): string[] {
  const container = sourceDocument.querySelector(ISSUE_LABELS_CONTAINER_SELECTOR);
  if (container === null) {
    return [];
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const element of container.querySelectorAll("a, span")) {
    if (element.getAttribute("aria-hidden") === "true") {
      continue;
    }
    const text = normalizeInlineText(element.textContent ?? "");
    if (text && !seen.has(text)) {
      seen.add(text);
      labels.push(text);
    }
  }
  return labels;
}

/**
 * Canonical URL is accepted only when it resolves to the exact same
 * GitHub Issue identity — the DOM can never rewrite issue identity.
 */
function resolveCanonicalUrl(
  sourceDocument: Document,
  identity: GitHubIssueIdentity,
): string | undefined {
  const link = sourceDocument.querySelector('link[rel="canonical"]');
  const href = link?.getAttribute("href");
  if (href === null || href === undefined) {
    return undefined;
  }
  const canonicalIdentity = parseGitHubIssueUrl(href);
  if (canonicalIdentity === null) {
    return undefined;
  }
  if (
    canonicalIdentity.owner !== identity.owner ||
    canonicalIdentity.repo !== identity.repo ||
    canonicalIdentity.issueNumber !== identity.issueNumber
  ) {
    return undefined;
  }
  return normalizeLinkUrl(href) ?? undefined;
}

function resolveAuthor(sourceDocument: Document): string | undefined {
  for (const selector of ISSUE_AUTHOR_SELECTORS) {
    const element = sourceDocument.querySelector(selector);
    if (element === null) {
      continue;
    }
    const text = normalizeInlineText(element.textContent ?? "");
    if (text) {
      return text;
    }
  }
  return undefined;
}

function resolvePublishedAt(sourceDocument: Document): string | undefined {
  for (const selector of ISSUE_CREATED_TIME_SELECTORS) {
    const element = sourceDocument.querySelector(selector);
    if (element === null) {
      continue;
    }
    const candidate = normalizeInlineText(
      element.getAttribute("datetime") ?? element.textContent ?? "",
    );
    if (candidate && !Number.isNaN(Date.parse(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

/** GitHub renders "No description provided." for empty issue bodies — not author content. */
function isNoDescriptionSentinelOnly(blocks: NormalizedDocument["blocks"]): boolean {
  if (blocks.length !== 1) {
    return false;
  }
  const block = blocks[0];
  return block.type === "paragraph" && block.text === EMPTY_BODY_SENTINEL_TEXT;
}
