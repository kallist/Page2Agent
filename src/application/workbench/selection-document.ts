/**
 * Selection / Lens fragment document builder (application layer).
 *
 * Lens picks and text selections become NormalizedDocuments with the SAME
 * source descriptor shape as full captures (identity parsed from the URL),
 * a scope of `selection` / `text-selection`, and the adapter that converted
 * the picked DOM. Blocks are never Markdown; source facts never guessed.
 */
import {
  collectAssetsFromBlocks,
  countDocumentCharacters,
  isNormalizedDocument,
  MAX_DOCUMENT_CHARACTERS,
  normalizeLinkUrl,
  Page2AgentError,
  Page2AgentErrorCode,
  DOCUMENT_ADAPTER_NAMES,
} from "../../core";
import type {
  ContentBlock,
  DocumentAdapterId,
  NormalizedDocument,
  SourceDescriptor,
} from "../../core";
import { parseGitHubIssueUrl, parseGitHubPullRequestUrl } from "../../adapters/github";

export interface SelectionDocumentInput {
  captureId: string;
  url: string;
  capturedAt: string;
  title: string;
  adapterId: DocumentAdapterId;
  scope: "selection" | "text-selection";
  blocks: ContentBlock[];
}

/** Resolve the canonical SourceDescriptor for the captured URL. */
export function sourceDescriptorForUrl(rawUrl: string): SourceDescriptor {
  const sourceUrl = normalizeLinkUrl(rawUrl);
  if (sourceUrl === null) {
    throw new Page2AgentError(Page2AgentErrorCode.UNSUPPORTED_PAGE);
  }
  const issue = parseGitHubIssueUrl(sourceUrl);
  if (issue !== null) {
    return {
      kind: "github_issue",
      url: sourceUrl,
      owner: issue.owner,
      repo: issue.repo,
      issueNumber: issue.issueNumber,
    };
  }
  const pullRequest = parseGitHubPullRequestUrl(sourceUrl);
  if (pullRequest !== null) {
    return {
      kind: "github_pull_request",
      url: sourceUrl,
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      prNumber: pullRequest.prNumber,
    };
  }
  return { kind: "web", url: sourceUrl };
}

/**
 * Build a validated fragment NormalizedDocument for picked content.
 * Throws NO_CONTENT_FOUND when nothing meaningful is picked and
 * CONTENT_TOO_LARGE when the pick exceeds the shared content policy.
 */
export function buildSelectionDocument(input: SelectionDocumentInput): NormalizedDocument {
  if (input.blocks.length === 0) {
    throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
  }
  const source = sourceDescriptorForUrl(input.url);
  const document: NormalizedDocument = {
    schemaVersion: 1,
    source,
    metadata: { title: input.title, capturedAt: input.capturedAt },
    blocks: input.blocks,
    assets: collectAssetsFromBlocks(input.blocks),
    capture: {
      adapter: {
        id: input.adapterId,
        name: DOCUMENT_ADAPTER_NAMES[input.adapterId],
      },
      scope: input.scope,
    },
  };
  if (!isNormalizedDocument(document)) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "The picked context could not be normalized.",
    });
  }
  if (countDocumentCharacters(document) > MAX_DOCUMENT_CHARACTERS) {
    throw new Page2AgentError(Page2AgentErrorCode.CONTENT_TOO_LARGE);
  }
  return document;
}
