/**
 * Article metadata extraction (generic). Deterministic precedence; invalid
 * optional metadata is ignored, never fatal. capturedAt is NOT read here —
 * it comes from PageContext at the extractor level.
 */
import { isSafeAbsoluteUrl, normalizeLinkUrl } from "../../core";
import { normalizeInlineText } from "./dom-to-blocks";

/** Public fields of Readability's parse() result used by Page2Agent. */
export interface ReadabilityArticle {
  title: string | null | undefined;
  content: string | null | undefined;
  byline: string | null | undefined;
  siteName: string | null | undefined;
  publishedTime: string | null | undefined;
}

export interface ExtractedMetadata {
  title: string;
  canonicalUrl?: string;
  site?: string;
  author?: string;
  publishedAt?: string;
}

export function extractMetadata(
  sourceDocument: Document,
  article: ReadabilityArticle,
  contextUrl: string,
): ExtractedMetadata {
  const metadata: ExtractedMetadata = {
    title: resolveTitle(sourceDocument, article, contextUrl),
  };
  const canonicalUrl = resolveCanonicalUrl(sourceDocument, contextUrl);
  const site = resolveSite(article, contextUrl);
  const author = resolveAuthor(sourceDocument, article);
  const publishedAt = resolvePublishedAt(sourceDocument, article);
  if (canonicalUrl !== undefined) {
    metadata.canonicalUrl = canonicalUrl;
  }
  if (site !== undefined) {
    metadata.site = site;
  }
  if (author !== undefined) {
    metadata.author = author;
  }
  if (publishedAt !== undefined) {
    metadata.publishedAt = publishedAt;
  }
  return metadata;
}

/** Title precedence: Readability title → og:title → document title → hostname. */
function resolveTitle(
  sourceDocument: Document,
  article: ReadabilityArticle,
  contextUrl: string,
): string {
  const candidates = [
    article.title,
    readMetaContent(sourceDocument, 'meta[property="og:title"]'),
    sourceDocument.title,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeInlineText(candidate ?? "");
    if (normalized) {
      return normalized;
    }
  }
  // Deterministic, human-readable fallback (canHandle guarantees parseable URL).
  return new URL(contextUrl).hostname;
}

/** Canonical URL only when http/https and safely normalized; otherwise undefined. */
function resolveCanonicalUrl(sourceDocument: Document, contextUrl: string): string | undefined {
  const link = sourceDocument.querySelector('link[rel="canonical"]');
  if (link === null) {
    return undefined;
  }
  const normalized = normalizeLinkUrl(link.getAttribute("href") ?? "", contextUrl);
  if (normalized === null || !isSafeAbsoluteUrl(normalized)) {
    return undefined;
  }
  return normalized;
}

/** Site: Readability siteName when meaningful, else URL hostname. */
function resolveSite(article: ReadabilityArticle, contextUrl: string): string | undefined {
  const siteName = normalizeInlineText(article.siteName ?? "");
  if (siteName) {
    return siteName;
  }
  return new URL(contextUrl).hostname;
}

/** Author: Readability byline, else meta[name="author"]. */
function resolveAuthor(sourceDocument: Document, article: ReadabilityArticle): string | undefined {
  const byline = normalizeInlineText(article.byline ?? "");
  if (byline) {
    return byline;
  }
  const metaAuthor = normalizeInlineText(
    readMetaContent(sourceDocument, 'meta[name="author"]') ?? "",
  );
  return metaAuthor || undefined;
}

/**
 * publishedAt only when a reliable source yields a valid ISO-like timestamp.
 * Relative phrases ("3 hours ago") are never guessed; <time> elements are not
 * consulted in V0.1 (documented limitation).
 */
function resolvePublishedAt(
  sourceDocument: Document,
  article: ReadabilityArticle,
): string | undefined {
  const candidates = [
    article.publishedTime,
    readMetaContent(sourceDocument, 'meta[property="article:published_time"]'),
    readMetaContent(sourceDocument, 'meta[name="date"]'),
  ];
  for (const candidate of candidates) {
    if (isValidIsoDateTime(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isValidIsoDateTime(value: string | null | undefined): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readMetaContent(sourceDocument: Document, selector: string): string | null {
  return sourceDocument.querySelector(selector)?.getAttribute("content") ?? null;
}
