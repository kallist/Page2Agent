/**
 * GitHub Issue DOM selectors — the only place GitHub-specific selectors live.
 *
 * Strategy: small ordered lists of long-stable structural/semantic selectors
 * (first match wins). These are documented GitHub page structures, not random
 * generated hash classes and not deep nth-child paths. GitHub DOM changes can
 * still break the adapter — that is a known limitation, not a guarantee.
 */

/** Issue title: bdi.js-issue-title is the long-stable title node; h1 fallbacks cover structural variants. */
export const ISSUE_TITLE_SELECTORS = [
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
  "div.js-comment-body",
  "div.comment-body.markdown-body",
] as const;

/** Issue labels region: stable js-issue-labels container (never repo topics/PR labels). */
export const ISSUE_LABELS_CONTAINER_SELECTOR = "div.js-issue-labels";

/** Issue author: the description comment header appears before any commenter. */
export const ISSUE_AUTHOR_SELECTORS = [
  "div.js-timeline-item a.author",
  "a.author",
] as const;

/** Issue creation time (not comment/edit time). */
export const ISSUE_CREATED_TIME_SELECTORS = [
  "div.gh-header-meta relative-time",
  "div.gh-header-meta time",
] as const;

/** GitHub's rendered empty-issue-body UI text (not author content). */
export const EMPTY_BODY_SENTINEL_TEXT = "No description provided.";

export function firstMatch(
  root: Document,
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
