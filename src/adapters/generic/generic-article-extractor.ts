/**
 * GenericArticleExtractor — Page2Agent's generic fallback extractor.
 *
 * Pipeline (canonical model only, never Markdown):
 *   live DOM → clone → Readability (main-content detection)
 *   → detached article document → semantic blocks → NormalizedDocument
 *
 * The same article-document pipeline is shared with the Technical
 * Documentation adapter (content normalization is identical there); the
 * adapter identity recorded in `capture` is the only difference.
 *
 * Invariants:
 * - The live page DOM is never mutated; Readability runs on a cloned,
 *   detached document only.
 * - Readability HTML is untrusted page data used only for detached parsing.
 * - Source facts come from PageContext; capturedAt is copied verbatim.
 * - No network requests, no logging of page content.
 */
import { Readability } from "@mozilla/readability";
import {
  collectAssetsFromBlocks,
  isNormalizedDocument,
  isRestrictedPageUrl,
  isSafeAbsoluteUrl,
  isWithinDocumentLimit,
  normalizeLinkUrl,
  Page2AgentError,
  Page2AgentErrorCode,
} from "../../core";
import type {
  ContentBlock,
  DocumentAdapterInfo,
  DocumentMetadata,
  ExtractionInput,
  NormalizedDocument,
  PageContext,
  PageExtractor,
  WebSourceDescriptor,
} from "../../core";
import { extractMetadata } from "./article-metadata";
import { domToBlocks } from "../../shared/dom/blocks";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/** Cheap deterministic eligibility shared with the docs adapter. */
export function isGenericEligibleContext(context: PageContext): boolean {
  let url: URL;
  try {
    url = new URL(context.url);
  } catch {
    return false;
  }
  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    return false;
  }
  return !isRestrictedPageUrl(context.url);
}

export class GenericArticleExtractor implements PageExtractor {
  readonly id = "generic-article";

  /**
   * Fallback policy: cheap and deterministic. Any http/https page that is not
   * a restricted browser page is eligible; whether meaningful content exists
   * is decided by extract().
   */
  canHandle(context: PageContext): boolean {
    return isGenericEligibleContext(context);
  }

  async extract(input: ExtractionInput): Promise<NormalizedDocument> {
    return extractArticleDocument(input, {
      id: "generic-article",
      name: "Generic Article",
    });
  }
}

/**
 * Shared article-document extraction pipeline used by the generic fallback
 * and the Technical Documentation adapter. The adapter identity is recorded
 * verbatim; extraction steps are identical for both.
 */
export async function extractArticleDocument(
  input: ExtractionInput,
  adapter: DocumentAdapterInfo,
): Promise<NormalizedDocument> {
  const { context, document: sourceDocument } = input;

  // 1. Clone the live document: Readability mutates its input document.
  const clonedDocument = cloneDocumentForReadability(sourceDocument);

  // 2. Main-content detection on the detached clone. keepClasses preserves
  //    language hints (language-python etc.) that Readability would strip.
  const article = new Readability(clonedDocument, { keepClasses: true }).parse();
  if (
    article === null ||
    article.content === null ||
    article.content === undefined ||
    article.content.trim() === ""
  ) {
    throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
  }

  // 3. Parse the article HTML into a detached document for normalization.
  const contentDocument = parseArticleContent(article.content, sourceDocument);

  // 4. Metadata (deterministic precedence; capturedAt from PageContext).
  const extracted = extractMetadata(sourceDocument, article, context.url);
  const metadata: DocumentMetadata = {
    title: extracted.title,
    capturedAt: context.capturedAt,
  };
  if (extracted.author !== undefined) {
    metadata.author = extracted.author;
  }
  if (extracted.publishedAt !== undefined) {
    metadata.publishedAt = extracted.publishedAt;
  }

  // 5. Semantic blocks in article reading order.
  const blocks = domToBlocks(contentDocument.body, context.url);
  if (blocks.length === 0) {
    throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
  }

  // 6. Drop a leading h1 that exactly duplicates the metadata title.
  dedupeLeadingTitleBlock(blocks, extracted.title);
  if (blocks.length === 0) {
    throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
  }

  // 7. Source descriptor: PageContext URL is the source of truth.
  const sourceUrl = normalizeLinkUrl(context.url);
  if (sourceUrl === null || !isSafeAbsoluteUrl(sourceUrl)) {
    throw new Page2AgentError(Page2AgentErrorCode.UNSUPPORTED_PAGE);
  }
  const source: WebSourceDescriptor = { kind: "web", url: sourceUrl };
  if (extracted.canonicalUrl !== undefined) {
    source.canonicalUrl = extracted.canonicalUrl;
  }
  if (extracted.site !== undefined) {
    source.site = extracted.site;
  }

  // 8. Build + validate the canonical document.
  const document: NormalizedDocument = {
    schemaVersion: 1,
    source,
    metadata,
    blocks,
    assets: collectAssetsFromBlocks(blocks),
    capture: { adapter: { id: adapter.id, name: adapter.name }, scope: "full-page" },
  };
  if (!isNormalizedDocument(document)) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT);
  }

  // 9. Content size policy: hard limit, no silent truncation.
  if (!isWithinDocumentLimit(document)) {
    throw new Page2AgentError(Page2AgentErrorCode.CONTENT_TOO_LARGE);
  }

  return document;
}

/**
 * Clone the live document via DOMParser so Readability can mutate freely.
 * DOMParser never executes scripts and works in both browser and jsdom.
 */
function cloneDocumentForReadability(sourceDocument: Document): Document {
  const DOMParserConstructor = sourceDocument.defaultView?.DOMParser;
  const sourceHtml = sourceDocument.documentElement?.outerHTML ?? "";
  if (DOMParserConstructor === undefined || sourceHtml.length === 0) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "The page DOM cannot be cloned for extraction.",
    });
  }
  return new DOMParserConstructor().parseFromString(sourceHtml, "text/html");
}

function parseArticleContent(articleContent: string, sourceDocument: Document): Document {
  const DOMParserConstructor = sourceDocument.defaultView?.DOMParser;
  if (DOMParserConstructor === undefined) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "The article content cannot be parsed.",
    });
  }
  return new DOMParserConstructor().parseFromString(articleContent, "text/html");
}

/**
 * Remove a leading HeadingBlock (level 1-2, Readability normalizes article h1
 * to h2) whose normalized text exactly equals the metadata title. Only exact
 * equivalence; never fuzzy matching.
 */
function dedupeLeadingTitleBlock(blocks: ContentBlock[], title: string): void {
  const first = blocks[0];
  if (
    first !== undefined &&
    first.type === "heading" &&
    first.level <= 2 &&
    first.text === title
  ) {
    blocks.shift();
  }
}
