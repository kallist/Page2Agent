import { describe, expect, it } from "vitest";
import {
  MAX_ESTIMATED_TOKENS,
  TOKEN_ESTIMATE_METHOD,
  estimateBlocksTokens,
  estimateContentBlockTokens,
  estimateDocumentTokens,
  estimateMetadataTokens,
  estimateTextTokens,
  estimateTokens,
} from "../../../../src/core/workbench/token-estimate";
import type { ContentBlock, NormalizedDocument } from "../../../../src/core";

function makeDocument(): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: {
      title: "Example Article",
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    blocks: [
      { type: "heading", level: 2, text: "Introduction" },
      { type: "paragraph", text: "Hello world." },
    ],
    assets: [],
  };
}

describe("estimateTextTokens", () => {
  it("is deterministic and never negative", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("a")).toBe(1);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
  });

  it("counts CJK code points as one token each", () => {
    expect(estimateTextTokens("中文测试")).toBe(4);
    expect(estimateTextTokens("こんにちは")).toBe(5);
    expect(estimateTextTokens("한국어")).toBe(3);
  });

  it("mixes wide and narrow text deterministically", () => {
    const mixed = estimateTextTokens("A中文bc");
    // A + b + c = 3 narrow → ceil(3/4) = 1; 中文 = 2 → 3
    expect(mixed).toBe(3);
  });

  it("labels every estimate with the documented method", () => {
    expect(estimateTokens("payload")).toEqual({
      tokens: 2,
      method: TOKEN_ESTIMATE_METHOD,
    });
  });

  it("caps at MAX_ESTIMATED_TOKENS", () => {
    expect(MAX_ESTIMATED_TOKENS).toBeGreaterThan(0);
    expect(estimateTextTokens("x".repeat(MAX_ESTIMATED_TOKENS * 10))).toBeGreaterThan(0);
  });
});

describe("estimateContentBlockTokens", () => {
  it("counts every block type from its content fields", () => {
    const blocks: ContentBlock[] = [
      { type: "heading", level: 2, text: "Section" },
      { type: "paragraph", text: "Some longer paragraph text here." },
      { type: "code", code: "const x = 1;\nconsole.log(x);" },
      { type: "quote", text: "Quoted text." },
      { type: "list", ordered: false, items: ["one", "two"] },
      { type: "image", src: "https://example.com/a.png", alt: "diagram" },
      { type: "link", href: "https://example.com/x", text: "reference" },
      {
        type: "table",
        headers: ["a", "b"],
        rows: [
          ["1", "2"],
          ["3", "4"],
        ],
      },
    ];
    const total = blocks.reduce((sum, block) => sum + estimateContentBlockTokens(block), 0);
    expect(total).toBeGreaterThan(0);
    expect(estimateBlocksTokens(blocks)).toBe(total);
  });

  it("treats an empty-text block as zero", () => {
    expect(estimateContentBlockTokens({ type: "paragraph", text: "" })).toBe(0);
  });
});

describe("estimateDocumentTokens", () => {
  it("counts content blocks only and ignores metadata", () => {
    const document = makeDocument();
    const expected =
      estimateContentBlockTokens(document.blocks[0]) +
      estimateContentBlockTokens(document.blocks[1]);
    expect(estimateDocumentTokens(document)).toBe(expected);
  });

  it("keeps metadata estimation separate (nutrition reporting)", () => {
    const document = makeDocument();
    expect(estimateMetadataTokens(document)).toBeGreaterThan(0);
    expect(estimateMetadataTokens(document)).not.toBe(estimateDocumentTokens(document));
  });

  it("is deterministic across calls", () => {
    const document = makeDocument();
    expect(estimateDocumentTokens(document)).toBe(estimateDocumentTokens(document));
  });
});
