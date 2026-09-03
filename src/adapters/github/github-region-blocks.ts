/**
 * GitHub region materialization — converts user-picked Lens regions INSIDE
 * an issue/PR body into blocks with the same fidelity guarantees as the
 * full-page GitHub adapter (task-list markers on clones only).
 *
 * GitHub-specific knowledge (the js-comment-body class) stays in this file
 * and never leaks into the generic lens code.
 */
import type { ContentBlock } from "../../core";
import { domToBlocks } from "../../shared/dom/blocks";
import { applyTaskListMarkers } from "./github-issue-body";

const GITHUB_BODY_REGION_SELECTOR = "div.js-comment-body, div.comment-body.markdown-body";

/** True when the element lives inside a GitHub issue/PR body region. */
export function isInsideGitHubBodyRegion(element: Element): boolean {
  return element.closest(GITHUB_BODY_REGION_SELECTOR) !== null;
}

/**
 * Clone each picked element into a detached container (never the live DOM),
 * apply GitHub task-list normalization to the clone, then run the shared
 * semantic walker over the cloned roots.
 */
export function githubRegionElementsToBlocks(
  elements: readonly Element[],
  sourceUrl: string,
): ContentBlock[] {
  if (elements.length === 0) {
    return [];
  }
  const container = elements[0].ownerDocument.createElement("div");
  for (const element of elements) {
    container.appendChild(element.cloneNode(true));
  }
  applyTaskListMarkers(container);
  return domToBlocks(container, sourceUrl);
}
