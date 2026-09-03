/**
 * TechnicalDocsExtractor — Page2Agent's Technical Documentation adapter
 * (V1.1).
 *
 * Detection (generated interpretation, never a source claim):
 *   docs-kind scoring → technical-docs identity, or honest generic fallback
 *   (capture.adapter = generic-article) when confidence is insufficient.
 *
 * Content normalization uses the same article pipeline as the generic
 * adapter (Readability on a detached clone → semantic blocks) — the
 * difference from Generic is page-kind classification, which drives receipts
 * and recipe suggestions (Build), never content rewriting.
 *
 * Invariants: same as the generic adapter — no DOM mutation, no network, no
 * invented metadata, extract-don't-invent.
 */
import {
  extractArticleDocument,
  isGenericEligibleContext,
} from "../generic";
import type { ExtractionInput, NormalizedDocument, PageContext, PageExtractor } from "../../core";
import { assessDocsKind } from "./docs-kind-detector";

export class TechnicalDocsExtractor implements PageExtractor {
  readonly id = "technical-docs";

  /** URL-level eligibility identical to the generic fallback. */
  canHandle(context: PageContext): boolean {
    return isGenericEligibleContext(context);
  }

  async extract(input: ExtractionInput): Promise<NormalizedDocument> {
    const assessment = assessDocsKind(input.document, input.context.url);
    if (!assessment.isDocs) {
      // Honest fallback: extraction is identical; only the classification
      // differed, so the generic adapter identity is recorded.
      return extractArticleDocument(input, {
        id: "generic-article",
        name: "Generic Article",
      });
    }
    return extractArticleDocument(input, {
      id: "technical-docs",
      name: "Technical Documentation",
    });
  }
}
