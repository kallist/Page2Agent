/**
 * GitHub Pull Request DOM selectors — the only place PR-specific selectors
 * live (same policy as github-issue-selectors: long-stable structural
 * selectors, first match wins, never random generated hash classes).
 */

/** PR title (react header test id first; legacy h1 fallbacks follow). */
export const PR_TITLE_SELECTORS = [
  '[data-testid="pr-header-title"]',
  "h1.js-issue-title",
  ".gh-header-title",
] as const;

/** PR state pill text: "Open" / "Closed" / "Merged" (Draft pills are not a state). */
export const PR_STATE_SELECTORS = [
  '[data-testid="pr-header-state"]',
  "span.State",
] as const;

/** PR branch refs container (base/head branch display names). */
export const PR_HEADER_CONTAINER_SELECTORS = [
  '[data-testid="pr-header"]',
  "#partial-discussion-header",
  ".gh-header",
] as const;

/** PR description: the FIRST js-comment-body in the conversation timeline is
 *  the PR description; review comments are later js-comment-body nodes. */
export const PR_DESCRIPTION_SELECTORS = [
  '[data-testid="pr-description"] [data-testid="markdown-body"]',
  "div.js-comment-body",
  "div.comment-body.markdown-body",
] as const;

/** PR description author (timeline author of the description item). */
export const PR_AUTHOR_SELECTORS = [
  "div.js-timeline-item a.author",
  "a.author",
] as const;

/** PR creation time — description header relative-time first. */
export const PR_CREATED_TIME_SELECTORS = [
  "div.js-timeline-item relative-time",
  "div.js-timeline-item time",
  "div.gh-header-meta relative-time",
] as const;

/** PR labels container (issue/PR share the sidebar Labels UI). */
export const PR_LABELS_CONTAINER_SELECTORS = [
  '[data-testid="issue-labels"]',
  '[data-testid="pr-labels"]',
  "div.js-issue-labels",
] as const;

export { firstMatch } from "./github-issue-selectors";
