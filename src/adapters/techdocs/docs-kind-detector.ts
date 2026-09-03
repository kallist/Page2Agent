/**
 * Technical Documentation kind detection (V1.1).
 *
 * Deterministic, DOM-only scoring — no per-site hardcoding, no URL allowlists
 * of specific vendors. The detector combines weak signals (URL hints,
 * documentation landmarks, API-shaped headings, code density, nav anchors)
 * and article-shaped negatives (og:type article, bylines, blog URL hints).
 *
 * Classification is Page2Agent's generated interpretation used to pick the
 * adapter identity and recipe suggestions; it is never presented as a source
 * claim. When confidence is insufficient the caller must fall back to the
 * Generic Article adapter instead of claiming "Technical Documentation".
 */

const URL_DOCS_HINT = /(^|\/)(docs?|documentation|reference|api|guide|guides|learn|manual)(\/|$)/i;
const URL_BLOG_HINT = /(^|\/)(blog|news|stories?)(\/|$)/i;
const DOCS_HOST_PREFIX = /(^|\.)docs?\./i;

/** Heading vocabulary typical of API/developer reference pages. */
const REFERENCE_HEADING_VOCABULARY = new Set([
  "parameters",
  "arguments",
  "options",
  "returns",
  "syntax",
  "usage",
  "examples",
  "example",
  "installation",
  "quickstart",
  "reference",
]);

/** Author/date markers that usually mean an article, not documentation. */
const ARTICLE_MARKER_SELECTORS = [
  "meta[property='og:type'][content='article']",
  "meta[name='article:published_time']",
  "meta[property='article:published_time']",
  ".post-meta",
  ".entry-meta",
  ".byline",
  "article time[datetime]",
] as const;

export const DOCS_CONFIDENCE_THRESHOLD = 4;

export interface DocsSignals {
  positive: string[];
  negative: string[];
}

export interface DocsKindAssessment {
  /** Positive minus negative evidence, in deterministic evaluation order. */
  score: number;
  isDocs: boolean;
  signals: DocsSignals;
}

/** Pure, deterministic classification of one rendered page. */
export function assessDocsKind(
  document: Document,
  pageUrl: string,
): DocsKindAssessment {
  const positive: string[] = [];
  const negative: string[] = [];
  let score = 0;

  const addPositive = (points: number, signal: string): void => {
    score += points;
    positive.push(signal);
  };
  const addNegative = (points: number, signal: string): void => {
    score -= points;
    negative.push(signal);
  };

  // URL hints (weak, never sufficient alone).
  if (DOCS_HOST_PREFIX.test(new URL(pageUrl).hostname)) {
    addPositive(1, "docs hostname");
  }
  if (URL_DOCS_HINT.test(new URL(pageUrl).pathname)) {
    addPositive(1, "docs URL path");
  }
  if (URL_BLOG_HINT.test(new URL(pageUrl).pathname)) {
    addNegative(2, "blog URL path");
  }

  // Documentation framework/landmark markers (strong).
  if (document.querySelector('[data-docusaurus-theme]') !== null) {
    addPositive(3, "docusaurus theme marker");
  }
  if (document.querySelector('.DocSearch, [data-testid="search-input"]') !== null) {
    addPositive(2, "docs search chrome");
  }

  // Structure: real headings, code density, reference tables, TOC anchors.
  const headings = [...document.querySelectorAll("h1, h2, h3, h4")];
  if (headings.length >= 4) {
    addPositive(1, "structured heading hierarchy");
  }
  const headingTexts = headings
    .map((heading) => (heading.textContent ?? "").toLowerCase().trim())
    .filter((text) => REFERENCE_HEADING_VOCABULARY.has(text));
  if (headingTexts.length >= 2) {
    addPositive(2, "reference heading vocabulary");
  } else if (headingTexts.length === 1) {
    addPositive(1, "reference heading vocabulary");
  }

  const codeElements = document.querySelectorAll("pre, code");
  if (codeElements.length >= 3) {
    addPositive(1, "code density");
  } else if (codeElements.length >= 1) {
    addPositive(1, "code present");
  }

  const tables = document.querySelectorAll("article table, main table, table");
  if (tables.length >= 2) {
    addPositive(1, "reference tables");
  }

  const article = document.querySelector("article, main");
  const tableOfContentsAnchors = (article ?? document).querySelectorAll('a[href^="#"]');
  if (tableOfContentsAnchors.length >= 6) {
    addPositive(1, "in-page anchor navigation");
  }

  // Article-shaped negatives.
  if (document.querySelector(ARTICLE_MARKER_SELECTORS.join(",")) !== null) {
    addNegative(3, "article/og:type markers");
  }
  const bodyText = (document.body?.textContent ?? "").trim();
  if (headings.length < 2 || bodyText.length < 300) {
    addNegative(2, "thin page");
  }

  return {
    score,
    isDocs: score >= DOCS_CONFIDENCE_THRESHOLD,
    signals: { positive, negative },
  };
}
