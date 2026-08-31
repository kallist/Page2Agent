/**
 * GitHub Issue body normalization.
 *
 * The issue body is GitHub-rendered Markdown HTML. It is normalized through
 * the shared site-neutral semantic walker (no Readability). Task-list
 * checkboxes are converted to textual markers on a CLONE of the body root —
 * the live DOM is never mutated.
 */
import type { ContentBlock } from "../../core";
import { domToBlocks } from "../../shared/dom/blocks";

const TASK_LIST_MARKER_ATTRIBUTE = "data-page2agent-tasklist";

/** Clone the body root so all cleanup/transformation happens off the live DOM. */
export function cloneBodyRoot(bodyRoot: Element): Element {
  return bodyRoot.cloneNode(true) as Element;
}

/**
 * Convert GitHub task-list checkboxes inside list items into textual markers
 * ("[x] "/"[ ] " prepended to the item). Applied once per checkbox; runs on
 * cloned DOM only. Checkbox state uses the `checked` IDL property, which
 * reflects the content attribute in jsdom and browsers.
 */
export function applyTaskListMarkers(root: Element): void {
  for (const input of root.querySelectorAll('input[type="checkbox"]')) {
    if (input.hasAttribute(TASK_LIST_MARKER_ATTRIBUTE)) {
      continue;
    }
    const li = input.closest("li");
    if (li === null) {
      continue;
    }
    input.setAttribute(TASK_LIST_MARKER_ATTRIBUTE, "1");
    const marker = (input as HTMLInputElement).checked ? "[x] " : "[ ] ";
    li.prepend(input.ownerDocument.createTextNode(marker));
  }
}

/** True when the body root carries no visible text at all. */
export function isBodyTextEmpty(bodyRoot: Element): boolean {
  return (bodyRoot.textContent ?? "").trim().length === 0;
}

/** Normalize a cloned issue body root into semantic blocks. */
export function extractIssueBodyBlocks(
  bodyRoot: Element,
  sourceUrl: string,
): ContentBlock[] {
  const clone = cloneBodyRoot(bodyRoot);
  applyTaskListMarkers(clone);
  return domToBlocks(clone, sourceUrl);
}
