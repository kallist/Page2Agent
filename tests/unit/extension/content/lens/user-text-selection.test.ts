// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  captureUserTextSelection,
  currentSelectionText,
  excerptOf,
  hasUserTextSelection,
} from "../../../../../src/extension/content/lens/user-text-selection";
import { isNormalizedDocument } from "../../../../../src/core";

function fakeWindowWith(text: string, collapsed = false): Window {
  return {
    getSelection: () =>
      ({
        toString: () => text,
        isCollapsed: collapsed,
        rangeCount: text.length > 0 ? 1 : 0,
      }) as unknown as Selection,
  } as unknown as Window;
}

const SESSION = {
  captureId: "capture-sel-1",
  url: "https://example.com/docs/page",
  capturedAt: "2026-09-01T00:00:00.000Z",
  pageTitle: "API docs",
};

describe("user text selection support", () => {
  it("detects meaningful selections", () => {
    expect(hasUserTextSelection({ window: fakeWindowWith("Hello world.") })).toBe(true);
    expect(hasUserTextSelection({ window: fakeWindowWith("") })).toBe(false);
    expect(hasUserTextSelection({ window: fakeWindowWith("hi", true) })).toBe(false);
  });

  it("reads the normalized selection text", () => {
    expect(currentSelectionText({ window: fakeWindowWith("  some text \n\n  " ) })).toBe("some text");
  });

  it("captures multi-paragraph selections as separate paragraphs", () => {
    const result = captureUserTextSelection(
      { window: fakeWindowWith("First paragraph line.\n\nSecond paragraph line.\nStill second.") },
      SESSION,
    );
    expect(result.characters).toBeGreaterThan(0);
    const document = result.document;
    expect(isNormalizedDocument(document)).toBe(true);
    expect(document.source.kind).toBe("web");
    expect(document.capture).toEqual({
      adapter: { id: "context-lens", name: "Context Lens" },
      scope: "text-selection",
    });
    const paragraphs = document.blocks.filter((block) => block.type === "paragraph");
    expect(paragraphs).toHaveLength(2);
    const texts = paragraphs.map((block) => (block.type === "paragraph" ? block.text : ""));
    expect(texts[0]).toBe("First paragraph line.");
    expect(texts[1]).toBe("Second paragraph line. Still second.");
    expect(document.metadata.title).toContain("Selection:");
    expect(result.excerpt.length).toBeGreaterThan(0);
  });

  it("fails cleanly when the selection is empty", () => {
    expect(() =>
      captureUserTextSelection({ window: fakeWindowWith("   ") }, SESSION),
    ).toThrow();
  });

  it("builds readable excerpts with an ellipsis", () => {
    expect(excerptOf("short text")).toBe("short text");
    const long = "x".repeat(200);
    expect(excerptOf(long)).toBe(`${"x".repeat(95)}…`);
  });
});
