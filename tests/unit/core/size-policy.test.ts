import { describe, expect, it } from "vitest";
import {
  countContentBlockCharacters,
  countDocumentCharacters,
  isWithinDocumentLimit,
  MAX_DOCUMENT_CHARACTERS,
} from "../../../src/core";
import type { ContentBlock, NormalizedDocument } from "../../../src/core";

const CAPTURED_AT = "2026-08-30T00:00:00.000Z";

function makeDocument(blocks: ContentBlock[]): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: { title: "Title", capturedAt: CAPTURED_AT },
    blocks,
    assets: [],
  };
}

describe("countContentBlockCharacters", () => {
  it("counts the textual payload of every block type", () => {
    expect(countContentBlockCharacters({ type: "heading", level: 1, text: "abc" })).toBe(3);
    expect(countContentBlockCharacters({ type: "paragraph", text: "abcd" })).toBe(4);
    expect(countContentBlockCharacters({ type: "code", code: "a\nb\n" })).toBe(4);
    expect(countContentBlockCharacters({ type: "quote", text: "ab" })).toBe(2);
    expect(
      countContentBlockCharacters({ type: "list", ordered: true, items: ["a", "bc"] }),
    ).toBe(3);
    expect(
      countContentBlockCharacters({
        type: "image",
        src: "https://example.com/a.png",
        alt: "abcd",
        title: "ef",
      }),
    ).toBe(6);
    expect(
      countContentBlockCharacters({
        type: "link",
        href: "https://example.com/very-long-target",
        text: "x",
      }),
    ).toBe(37);
    expect(
      countContentBlockCharacters({
        type: "table",
        headers: ["h1", "h2"],
        rows: [["a", "bb"], ["ccc", "d"]],
      }),
    ).toBe(11);
  });

  it("ignores image src in the count (content references only)", () => {
    expect(
      countContentBlockCharacters({ type: "image", src: "https://example.com/a.png" }),
    ).toBe(0);
  });
});

describe("countDocumentCharacters / limit", () => {
  it("counts blocks but not metadata", () => {
    const document = makeDocument([
      { type: "paragraph", text: "0123456789" },
      { type: "code", code: "code" },
    ]);
    expect(countDocumentCharacters(document)).toBe(14);
  });

  it("is deterministic", () => {
    const document = makeDocument([{ type: "paragraph", text: "x" }]);
    expect(countDocumentCharacters(document)).toBe(countDocumentCharacters(document));
  });

  it("accepts documents at the exact limit and rejects one char above", () => {
    const atLimit = makeDocument([{ type: "paragraph", text: "a".repeat(MAX_DOCUMENT_CHARACTERS) }]);
    expect(isWithinDocumentLimit(atLimit)).toBe(true);

    const aboveLimit = makeDocument([
      { type: "paragraph", text: "a".repeat(MAX_DOCUMENT_CHARACTERS + 1) },
    ]);
    expect(isWithinDocumentLimit(aboveLimit)).toBe(false);
  });

  it("counts code, list and table content toward the limit", () => {
    const document = makeDocument([
      { type: "code", code: "c".repeat(100) },
      { type: "list", ordered: false, items: ["i".repeat(50), "j".repeat(50)] },
      { type: "table", rows: [["k".repeat(25)], ["l".repeat(25)]] },
    ]);
    expect(countDocumentCharacters(document)).toBe(250);
  });
});
