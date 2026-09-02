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
const MODERN_TASK_ITEM_SELECTOR = '[data-testid^="tasklist-item-"]';

/**
 * GitHub progressively enhances task-list items with non-source UI. These
 * descendants can include a visual checkbox marker and screen-reader drag
 * instructions. They are absent from the issue bodyHTML source and must not
 * become ListBlock text.
 *
 * Keep this policy inside the GitHub adapter: the shared DOM walker also
 * serves generic pages, where site-specific cleanup would be incorrect.
 */
const NON_SOURCE_TASK_UI_SELECTOR = [
  "[hidden]",
  '[aria-hidden="true"]',
  "[aria-live]",
  '[role="status"]',
  ".sr-only",
  ".sr-only-focusable",
  '[data-component="VisuallyHidden"]',
].join(",");

/** Clone the body root so all cleanup/transformation happens off the live DOM. */
export function cloneBodyRoot(bodyRoot: Element): Element {
  return bodyRoot.cloneNode(true) as Element;
}

/**
 * Recover GitHub's current task-item boundaries before the site-neutral list
 * walker runs. Modern GitHub can render several source tasks inside one outer
 * <li>; each stable tasklist-item test anchor owns its own checkbox and source
 * content. Replacing that UI shell with ordinary sibling <li> elements keeps
 * the existing flat ListBlock contract while discarding drag-only siblings.
 */
function normalizeModernTaskListItems(root: Element): void {
  const itemsByOuterListItem = new Map<Element, Element[]>();

  for (const taskItem of root.querySelectorAll(MODERN_TASK_ITEM_SELECTOR)) {
    if (taskItem.querySelector('input[type="checkbox"]') === null) {
      continue;
    }
    const outerListItem = taskItem.closest("li");
    if (outerListItem === null) {
      continue;
    }
    const items = itemsByOuterListItem.get(outerListItem) ?? [];
    items.push(taskItem);
    itemsByOuterListItem.set(outerListItem, items);
  }

  for (const [outerListItem, taskItems] of itemsByOuterListItem) {
    const parentList = outerListItem.parentElement;
    if (parentList === null || (parentList.tagName !== "UL" && parentList.tagName !== "OL")) {
      continue;
    }

    const semanticItems = taskItems.map((taskItem) => {
      const input = taskItem.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const semanticItem = taskItem.ownerDocument.createElement("li");
      const sourceContent = taskItem.cloneNode(true) as Element;

      for (const control of sourceContent.querySelectorAll('input[type="checkbox"]')) {
        control.remove();
      }
      for (const nonSourceUi of sourceContent.querySelectorAll(NON_SOURCE_TASK_UI_SELECTOR)) {
        nonSourceUi.remove();
      }

      semanticItem.append(
        taskItem.ownerDocument.createTextNode(input.checked ? "[x] " : "[ ] "),
        sourceContent,
      );
      return semanticItem;
    });

    outerListItem.replaceWith(...semanticItems);
  }
}

/**
 * Convert GitHub task-list checkboxes inside list items into textual markers
 * ("[x] "/"[ ] " prepended to the item). Applied once per checkbox; runs on
 * cloned DOM only. Checkbox state uses the `checked` IDL property, which
 * reflects the content attribute in jsdom and browsers.
 */
export function applyTaskListMarkers(root: Element): void {
  normalizeModernTaskListItems(root);
  for (const input of root.querySelectorAll('input[type="checkbox"]')) {
    if (input.hasAttribute(TASK_LIST_MARKER_ATTRIBUTE)) {
      continue;
    }
    const li = input.closest("li");
    if (li === null) {
      continue;
    }
    for (const nonSourceUi of li.querySelectorAll(NON_SOURCE_TASK_UI_SELECTOR)) {
      nonSourceUi.remove();
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
