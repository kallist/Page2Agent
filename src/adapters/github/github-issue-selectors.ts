/**
 * GitHub Issue DOM selectors — the only place GitHub-specific selectors live.
 *
 * Strategy: small ordered lists of long-stable structural/semantic selectors
 * (first match wins). These are documented GitHub page structures, not random
 * generated hash classes and not deep nth-child paths. GitHub DOM changes can
 * still break the adapter — that is a known limitation, not a guarantee.
 */

/** Issue title: current semantic test ID first; legacy structural fallbacks follow. */
export const ISSUE_TITLE_SELECTORS = [
  '[data-testid="issue-title"]',
  "bdi.js-issue-title",
  "h1.js-issue-title",
  ".gh-header-title",
] as const;

/**
 * Issue body: the FIRST js-comment-body in document order is the primary
 * issue description; comments are later js-comment-body nodes and must never
 * be included. The second selector is a fallback shape without js-* classes.
 */
export const ISSUE_BODY_SELECTORS = [
  '[data-testid="issue-body"] [data-testid="markdown-body"]',
  "div.js-comment-body",
  "div.comment-body.markdown-body",
] as const;

/** Issue labels region only (never repository topics or pull-request labels). */
export const ISSUE_LABELS_CONTAINER_SELECTORS = [
  '[data-testid="issue-labels"]',
  "div.js-issue-labels",
] as const;

/** Issue author: the description comment header appears before any commenter. */
export const ISSUE_AUTHOR_SELECTORS = [
  '[data-testid="issue-body"] [data-testid="issue-body-header-author"]',
  "div.js-timeline-item a.author",
  "a.author",
] as const;

/** Issue creation time (not comment/edit time). */
export const ISSUE_CREATED_TIME_SELECTORS = [
  '[data-testid="issue-body"] [data-testid="issue-body-header-link"] relative-time',
  "div.gh-header-meta relative-time",
  "div.gh-header-meta time",
] as const;

/** GitHub's rendered empty-issue-body UI text (not author content). */
export const EMPTY_BODY_SENTINEL_TEXT = "No description provided.";

export function firstMatch(
  root: ParentNode,
  selectors: readonly string[],
): Element | null {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element !== null) {
      return element;
    }
  }
  return null;
}
