/**
 * GitHubPullRequestExtractor — Page2Agent's GitHub Pull Request adapter
 * (V1.1).
 *
 * Pipeline mirrors the Issue adapter:
 *   PageContext URL → PR identity → PR DOM region → cloned description
 *   subtree → semantic blocks → GitHubPullRequest SourceDescriptor →
 *   NormalizedDocument → domain validation → size policy.
 *
 * Invariants:
 * - Identity (owner/repo/prNumber) comes ONLY from the PageContext URL.
 * - State, base/head branch names and labels are OPTIONAL rendered-DOM facts;
 *   they are omitted when the DOM does not expose them or when the state
 *   text is not an unambiguous Open/Closed/Merged value. Draft pills are not
 *   treated as a state.
 * - Review comments never become part of the PR description — the first
 *   js-comment-body is the description; the rest is never extracted.
 * - No GitHub API, no token, no network, no DOM mutation, no invented data.
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
  GitHubPullRequestSourceDescriptor,
  GitHubPullRequestState,
  NormalizedDocument,
  PageContext,
  PageExtractor,
} from "../../core";
import { normalizeInlineText } from "../../shared/dom/text";
import { extractIssueBodyBlocks, isBodyTextEmpty } from "./github-issue-body";
import { extractLabelsFromContainer } from "./github-labels";
import {
  PR_AUTHOR_SELECTORS,
  PR_CREATED_TIME_SELECTORS,
  PR_DESCRIPTION_SELECTORS,
  PR_HEADER_CONTAINER_SELECTORS,
  PR_LABELS_CONTAINER_SELECTORS,
  PR_STATE_SELECTORS,
  PR_TITLE_SELECTORS,
  firstMatch,
} from "./github-pr-selectors";
import { parseGitHubPullRequestUrl } from "./github-pr-url";
import type { GitHubPullRequestIdentity } from "./github-pr-url";

/** Max branch refs collected (base + head only). */
const BRANCH_REF_LIMIT = 2;

export class GitHubPullRequestExtractor implements PageExtractor {
  readonly id = "github-pull-request";

  /** URL-only, cheap, deterministic detection. */
  canHandle(context: PageContext): boolean {
    return parseGitHubPullRequestUrl(context.url) !== null;
  }

  async extract(input: ExtractionInput): Promise<NormalizedDocument> {
    const { context, document: sourceDocument } = input;

    const identity = parseGitHubPullRequestUrl(context.url);
    if (identity === null) {
      throw new Page2AgentError(Page2AgentErrorCode.UNSUPPORTED_PAGE);
    }

    const titleElement = firstMatch(sourceDocument, PR_TITLE_SELECTORS);
    const titleText =
      titleElement === null ? "" : normalizeInlineText(titleElement.textContent ?? "");
    const metadataTitle =
      titleText || `${identity.owner}/${identity.repo} pull request #${identity.prNumber}`;

    const descriptionRoot = firstMatch(sourceDocument, PR_DESCRIPTION_SELECTORS);
    if (descriptionRoot === null || isBodyTextEmpty(descriptionRoot)) {
      throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
    }
    const blocks = extractIssueBodyBlocks(descriptionRoot, context.url);
    if (blocks.length === 0) {
      throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
    }

    const metadata: DocumentMetadata = { title: metadataTitle, capturedAt: context.capturedAt };
    const author = resolveAuthor(sourceDocument);
    if (author !== undefined) {
      metadata.author = author;
    }
    const publishedAt = resolvePublishedAt(sourceDocument);
    if (publishedAt !== undefined) {
      metadata.publishedAt = publishedAt;
    }

    const sourceUrl = normalizeLinkUrl(context.url);
    if (sourceUrl === null) {
      throw new Page2AgentError(Page2AgentErrorCode.UNSUPPORTED_PAGE);
    }
    const source: GitHubPullRequestSourceDescriptor = {
      kind: "github_pull_request",
      url: sourceUrl,
      owner: identity.owner,
      repo: identity.repo,
      prNumber: identity.prNumber,
    };

    const canonicalUrl = resolveCanonicalUrl(sourceDocument, identity);
    if (canonicalUrl !== undefined) {
      source.canonicalUrl = canonicalUrl;
    }
    const state = resolveState(sourceDocument);
    if (state !== undefined) {
      source.state = state;
    }
    const [baseBranch, headBranch] = resolveBranchRefs(sourceDocument);
    if (baseBranch !== undefined) {
      source.baseBranch = baseBranch;
    }
    if (headBranch !== undefined) {
      source.headBranch = headBranch;
    }
    const labels = extractLabelsFromContainer(sourceDocument, PR_LABELS_CONTAINER_SELECTORS);
    if (labels.length > 0) {
      source.labels = labels;
    }

    const document: NormalizedDocument = {
      schemaVersion: 1,
      source,
      metadata,
      blocks,
      assets: collectAssetsFromBlocks(blocks),
      capture: {
        adapter: { id: "github-pull-request", name: "GitHub Pull Request" },
        scope: "full-page",
      },
    };
    if (!isNormalizedDocument(document)) {
      throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT);
    }
    if (!isWithinDocumentLimit(document)) {
      throw new Page2AgentError(Page2AgentErrorCode.CONTENT_TOO_LARGE);
    }
    return document;
  }
}

/**
 * Canonical URL is accepted only when it resolves to the exact same PR
 * identity — the DOM can never rewrite PR identity.
 */
function resolveCanonicalUrl(
  sourceDocument: Document,
  identity: GitHubPullRequestIdentity,
): string | undefined {
  const link = sourceDocument.querySelector('link[rel="canonical"]');
  const href = link?.getAttribute("href");
  if (href === null || href === undefined) {
    return undefined;
  }
  const canonicalIdentity = parseGitHubPullRequestUrl(href);
  if (canonicalIdentity === null) {
    return undefined;
  }
  if (
    canonicalIdentity.owner !== identity.owner ||
    canonicalIdentity.repo !== identity.repo ||
    canonicalIdentity.prNumber !== identity.prNumber
  ) {
    return undefined;
  }
  return normalizeLinkUrl(href) ?? undefined;
}

function resolveState(sourceDocument: Document): GitHubPullRequestState | undefined {
  const element = firstMatch(sourceDocument, PR_STATE_SELECTORS);
  if (element === null) {
    return undefined;
  }
  const text = normalizeInlineText(element.textContent ?? "").toLowerCase();
  if (text.startsWith("merged")) {
    return "merged";
  }
  if (text.startsWith("closed")) {
    return "closed";
  }
  if (text.startsWith("open")) {
    return "open";
  }
  return undefined; // "Draft" and friends are not a state; unknown stays unknown
}

/**
 * Base/head branch display names from the PR header, in the order GitHub
 * renders them ("… into {base} from {head}"). At most two refs are used.
 */
function resolveBranchRefs(sourceDocument: Document): [string | undefined, string | undefined] {
  const container = firstMatch(sourceDocument, PR_HEADER_CONTAINER_SELECTORS);
  if (container === null) {
    return [undefined, undefined];
  }
  const refs: string[] = [];
  for (const refElement of container.querySelectorAll("span.commit-ref")) {
    const text = normalizeInlineText(refElement.textContent ?? "");
    if (text.length > 0) {
      refs.push(text);
    }
    if (refs.length >= BRANCH_REF_LIMIT) {
      break;
    }
  }
  return [refs[0], refs[1]];
}

function resolveAuthor(sourceDocument: Document): string | undefined {
  for (const selector of PR_AUTHOR_SELECTORS) {
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
  for (const selector of PR_CREATED_TIME_SELECTORS) {
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
