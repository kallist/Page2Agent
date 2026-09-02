import { Page2AgentError, Page2AgentErrorCode } from "../errors";
import type { PageContext } from "../types/page-context";
import type { PageExtractor } from "./page-extractor";

/**
 * Deterministic extractor selection. Constructor order = priority; the first
 * extractor whose canHandle() returns true wins. Site-specific extractors
 * (e.g. GitHubIssueExtractor) must be registered before the generic fallback.
 */
export class ExtractorRegistry {
  private readonly extractors: readonly PageExtractor[];

  constructor(extractors: readonly PageExtractor[]) {
    const seen = new Set<string>();
    for (const extractor of extractors) {
      if (seen.has(extractor.id)) {
        throw new Page2AgentError(Page2AgentErrorCode.INVALID_REGISTRY, {
          message: `Duplicate extractor id: ${extractor.id}`,
        });
      }
      seen.add(extractor.id);
    }
    this.extractors = extractors;
  }

  /** First matching extractor, or null when none can handle the context. */
  resolve(context: PageContext): PageExtractor | null {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(context)) {
        return extractor;
      }
    }
    return null;
  }
}
