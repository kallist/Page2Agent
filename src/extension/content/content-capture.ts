/**
 * Content Script capture handler (production runtime).
 *
 * Runs in the page's isolated world. Validates the incoming PageContext,
 * checks page navigation before/after extraction, resolves the production
 * ExtractorRegistry (GitHub first, Generic fallback), and returns only a
 * validated NormalizedDocument — never DOM or HTML.
 */
import { ExtractorRegistry, isNormalizedDocument, Page2AgentErrorCode, userSafeMessage } from "../../core";
import type { NormalizedDocument, PageContext } from "../../core";
import { GenericArticleExtractor } from "../../adapters/generic";
import { GitHubIssueExtractor, GitHubPullRequestExtractor } from "../../adapters/github";
import { TechnicalDocsExtractor } from "../../adapters/techdocs";
import { toCaptureErrorView } from "../capture/capture-result";
import type { CaptureErrorView } from "../capture/capture-result";
import {
  CONTENT_CAPTURE_FAILURE,
  CONTENT_CAPTURE_SUCCESS,
  isContentCaptureRequest,
} from "../messaging/runtime-messages";
import type { ContentCaptureFailure, ContentCaptureSuccess } from "../messaging/runtime-messages";
import { isSameCapturedPage } from "../messaging/page-url";

/**
 * Stateless production registry. Immutable; holds no capture state, so a
 * module-level instance is MV3-safe. Order = priority: site-specific GitHub
 * adapters, then the Technical Documentation adapter (which honestly falls
 * back to Generic inside extract() when confidence is insufficient), then
 * the generic fallback.
 */
export function createProductionRegistry(): ExtractorRegistry {
  return new ExtractorRegistry([
    new GitHubIssueExtractor(),
    new GitHubPullRequestExtractor(),
    new TechnicalDocsExtractor(),
    new GenericArticleExtractor(),
  ]);
}

export interface ContentCaptureDeps {
  locationHref(): string;
  document: Document;
  registry: ExtractorRegistry;
}

export async function handleContentCaptureRequest(
  message: unknown,
  deps: ContentCaptureDeps,
): Promise<ContentCaptureSuccess | ContentCaptureFailure> {
  if (!isContentCaptureRequest(message)) {
    return contentFailure(
      "unknown",
      { code: Page2AgentErrorCode.INVALID_MESSAGE, message: userSafeMessage(Page2AgentErrorCode.INVALID_MESSAGE) },
    );
  }
  const context: PageContext = message.context;

  if (!isSameCapturedPage(context.url, deps.locationHref())) {
    return contentFailure(context.captureId, {
      code: Page2AgentErrorCode.PAGE_NAVIGATED,
      message: userSafeMessage(Page2AgentErrorCode.PAGE_NAVIGATED),
    });
  }

  const extractor = deps.registry.resolve(context);
  if (extractor === null) {
    return contentFailure(context.captureId, {
      code: Page2AgentErrorCode.UNSUPPORTED_PAGE,
      message: userSafeMessage(Page2AgentErrorCode.UNSUPPORTED_PAGE),
    });
  }

  let document: NormalizedDocument;
  try {
    document = await extractor.extract({ context, document: deps.document });
  } catch (error) {
    return contentFailure(context.captureId, toCaptureErrorView(error));
  }

  if (!isSameCapturedPage(context.url, deps.locationHref())) {
    return contentFailure(context.captureId, {
      code: Page2AgentErrorCode.PAGE_NAVIGATED,
      message: userSafeMessage(Page2AgentErrorCode.PAGE_NAVIGATED),
    });
  }
  if (!isNormalizedDocument(document)) {
    return contentFailure(context.captureId, {
      code: Page2AgentErrorCode.INVALID_DOCUMENT,
      message: userSafeMessage(Page2AgentErrorCode.INVALID_DOCUMENT),
    });
  }

  return { type: CONTENT_CAPTURE_SUCCESS, captureId: context.captureId, document };
}

function contentFailure(
  captureId: string,
  error: CaptureErrorView,
): ContentCaptureFailure {
  return { type: CONTENT_CAPTURE_FAILURE, captureId, error };
}
