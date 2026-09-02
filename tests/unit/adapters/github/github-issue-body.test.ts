// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyTaskListMarkers,
  cloneBodyRoot,
  extractIssueBodyBlocks,
} from "../../../../src/adapters/github";
import { getNormalizedText } from "../../../../src/shared/dom/text";
import { loadHtml } from "../../../helpers/load-html-fixture";

function bodyFrom(html: string): Element {
  const document = loadHtml(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body.firstElementChild;
  if (body === null) {
    throw new Error("test fixture must have a body root element");
  }
  return body;
}

describe("applyTaskListMarkers", () => {
  it("prepends [x] for checked and [ ] for unchecked checkboxes", () => {
    const root = bodyFrom(
      '<ul><li class="task-list-item"><input type="checkbox" checked="" disabled=""><p>done</p></li>' +
        '<li class="task-list-item"><input type="checkbox" disabled=""><p>todo</p></li></ul>',
    );
    applyTaskListMarkers(root);
    const items = [...root.querySelectorAll("li")].map((li) => getNormalizedText(li));
    expect(items).toEqual(["[x] done", "[ ] todo"]);
  });

  it("is idempotent (one marker per checkbox)", () => {
    const root = bodyFrom(
      '<ul><li><input type="checkbox" checked=""><p>done</p></li></ul>',
    );
    applyTaskListMarkers(root);
    applyTaskListMarkers(root);
    const text = getNormalizedText(root.querySelector("li")!);
    expect(text).toBe("[x] done");
  });

  it("ignores non-checkbox inputs", () => {
    const root = bodyFrom('<ul><li><input type="text" value="x"><p>plain</p></li></ul>');
    applyTaskListMarkers(root);
    expect(getNormalizedText(root.querySelector("li")!)).toBe("plain");
  });
});

describe("cloneBodyRoot", () => {
  it("protects the original DOM from clone mutation", () => {
    const root = bodyFrom('<div class="markdown-body"><p>Original text.</p></div>');
    const clone = cloneBodyRoot(root);
    clone.querySelector("p")?.replaceChildren("Mutated");
    applyTaskListMarkers(clone);
    expect(root.querySelector("p")?.textContent).toBe("Original text.");
    expect(root.outerHTML).toBe('<div class="markdown-body"><p>Original text.</p></div>');
  });
});

describe("extractIssueBodyBlocks", () => {
  it("normalizes a GitHub-rendered body with task list state", () => {
    const root = bodyFrom(
      '<div class="markdown-body">' +
        '<p>Intro.</p>' +
        '<ul><li class="task-list-item"><input type="checkbox" checked="" disabled=""><p>reproduce</p></li></ul>' +
        "</div>",
    );
    const blocks = extractIssueBodyBlocks(root, "https://github.com/a/b/issues/1");
    expect(blocks).toEqual([
      { type: "paragraph", text: "Intro." },
      { type: "list", ordered: false, items: ["[x] reproduce"] },
    ]);
  });

  it("preserves modern unchecked task content and discards its outer DnD UI", () => {
    const root = bodyFrom(
      '<div class="markdown-body"><ul class="contains-task-list"><li class="base-task-list-item">' +
        '<div><div data-testid="tasklist-item-2-0"><input type="checkbox" disabled="">' +
        '<div>Keep <a href="/a/b/issues/2">linked</a> <code>source</code> text.</div></div></div>' +
        '<div id="DndDescribedBy-2" style="display:none">drag-only text</div>' +
        '<div id="DndLiveRegion-2" role="status" aria-live="assertive">status-only text</div>' +
        "</li></ul></div>",
    );
    const blocks = extractIssueBodyBlocks(root, "https://github.com/a/b/issues/1");

    expect(blocks).toContainEqual({
      type: "list",
      ordered: false,
      items: ["[ ] Keep linked source text."],
    });
    expect(blocks).toContainEqual({
      type: "link",
      href: "https://github.com/a/b/issues/2",
      text: "linked",
    });
    expect(JSON.stringify(blocks)).not.toContain("drag-only text");
    expect(JSON.stringify(blocks)).not.toContain("status-only text");
  });
});
