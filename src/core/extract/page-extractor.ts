import type { NormalizedDocument } from "../types/document";
import type { PageContext } from "../types/page-context";

/**
 * Input for extraction: the browser runtime context plus the already-loaded
 * DOM. The DOM Web API is allowed in core (extraction works on real DOM);
 * React, Chrome extension runtime, and tab APIs are not.
 */
export interface ExtractionInput {
  context: PageContext;
  document: Document;
}

/**
 * The primary source extension point. Adapters implement this contract; core
 * never imports adapters.
 *
 * Error policy: expected domain failures (NO_CONTENT_FOUND, CONTENT_TOO_LARGE,
 * INVALID_DOCUMENT, ...) are thrown as Page2AgentError. Unexpected exceptions
 * are converted to CAPTURE_FAILED at the application boundary — extractors
 * must not blanket-catch everything themselves.
 */
export interface PageExtractor {
  readonly id: string;

  /**
   * Pure, cheap, deterministic selection predicate. Must not mutate the DOM,
   * parse content, or throw for ordinary unsupported pages.
   */
  canHandle(context: PageContext): boolean;

  /**
   * Unified async contract. A Promise is used even for synchronous DOM parsing
   * so future legitimate extractors can do local async processing — remote
   * network extraction remains forbidden in V0.1.
   */
  extract(input: ExtractionInput): Promise<NormalizedDocument>;
}
