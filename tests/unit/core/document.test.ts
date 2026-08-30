import { describe, expect, it } from "vitest";
import {
  collectAssetsFromBlocks,
  isAsset,
  isContentBlock,
  isDocumentMetadata,
  isGitHubIssueSourceDescriptor,
  isNormalizedDocument,
  isSourceDescriptor,
  isWebSourceDescriptor,
} from "../../../src/core";
import type { ContentBlock, NormalizedDocument } from "../../../src/core";

function makeDocument(overrides: Record<string, unknown> = {}): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: { title: "Article title", capturedAt: "2026-08-30T00:00:00.000Z" },
    blocks: [{ type: "paragraph", text: "Meaningful content." }],
    assets: [],
    ...overrides,
  } as unknown as NormalizedDocument;
}

describe("SourceDescriptor", () => {
  it("accepts a valid web source", () => {
    expect(
      isWebSourceDescriptor({ kind: "web", url: "https://example.com/article" }),
    ).toBe(true);
    expect(
      isSourceDescriptor({
        kind: "web",
        url: "https://example.com/article",
        canonicalUrl: "https://example.com/article?p=1",
        site: "example.com",
      }),
    ).toBe(true);
  });

  it("rejects web sources with unsafe or relative URLs", () => {
    expect(isWebSourceDescriptor({ kind: "web", url: "javascript:alert(1)" })).toBe(false);
    expect(isWebSourceDescriptor({ kind: "web", url: "/article" })).toBe(false);
    expect(isWebSourceDescriptor({ kind: "web", url: "https://example.com", extra: 1 })).toBe(
      false,
    );
    expect(isWebSourceDescriptor({ kind: "web", url: "https://example.com" })).toBe(true);
  });

  it("accepts a valid github_issue source", () => {
    expect(
      isGitHubIssueSourceDescriptor({
        kind: "github_issue",
        url: "https://github.com/acme/widgets/issues/42",
        owner: "acme",
        repo: "widgets",
        issueNumber: 42,
      }),
    ).toBe(true);
    expect(
      isGitHubIssueSourceDescriptor({
        kind: "github_issue",
        url: "https://github.com/acme/widgets/issues/42",
        owner: "acme",
        repo: "widgets",
        issueNumber: 42,
        labels: ["bug", "p1"],
      }),
    ).toBe(true);
  });

  it("rejects invalid issue numbers", () => {
    for (const issueNumber of [0, -3, 1.5, NaN]) {
      expect(
        isGitHubIssueSourceDescriptor({
          kind: "github_issue",
          url: "https://github.com/acme/widgets/issues/42",
          owner: "acme",
          repo: "widgets",
          issueNumber,
        }),
      ).toBe(false);
    }
  });

  it("rejects empty owner/repo and dirty labels", () => {
    expect(
      isGitHubIssueSourceDescriptor({
        kind: "github_issue",
        url: "https://github.com/acme/widgets/issues/42",
        owner: "",
        repo: "widgets",
        issueNumber: 42,
      }),
    ).toBe(false);
    expect(
      isGitHubIssueSourceDescriptor({
        kind: "github_issue",
        url: "https://github.com/acme/widgets/issues/42",
        owner: "acme",
        repo: "  ",
        issueNumber: 42,
      }),
    ).toBe(false);
    expect(
      isGitHubIssueSourceDescriptor({
        kind: "github_issue",
        url: "https://github.com/acme/widgets/issues/42",
        owner: "acme",
        repo: "widgets",
        issueNumber: 42,
        labels: ["ok", ""],
      }),
    ).toBe(false);
  });
});

describe("DocumentMetadata", () => {
  it("accepts minimal and full metadata", () => {
    expect(
      isDocumentMetadata({ title: "T", capturedAt: "2026-08-30T00:00:00.000Z" }),
    ).toBe(true);
    expect(
      isDocumentMetadata({
        title: "T",
        author: "Ada",
        publishedAt: "2026-08-01T10:00:00.000Z",
        capturedAt: "2026-08-30T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects whitespace title, invalid publishedAt, missing capturedAt", () => {
    expect(isDocumentMetadata({ title: "  ", capturedAt: "2026-08-30T00:00:00.000Z" })).toBe(
      false,
    );
    expect(
      isDocumentMetadata({
        title: "T",
        publishedAt: "not-a-date",
        capturedAt: "2026-08-30T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(isDocumentMetadata({ title: "T" })).toBe(false);
    expect(isDocumentMetadata({ title: "T", capturedAt: "2026-08-30T00:00:00.000Z", x: 1 })).toBe(
      false,
    );
  });
});

describe("ContentBlock", () => {
  it("accepts every block type with valid payloads", () => {
    const blocks: ContentBlock[] = [
      { type: "heading", level: 2, text: "Section" },
      { type: "paragraph", text: "Body text." },
      { type: "code", code: "const x = 1;\n", language: "ts" },
      { type: "quote", text: "Quoted." },
      { type: "list", ordered: false, items: ["one", "two"] },
      { type: "image", src: "https://example.com/img.png", alt: "diagram", title: "Fig 1" },
      { type: "link", href: "https://example.com/target", text: "see docs" },
      { type: "table", headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] },
      { type: "table", rows: [["only-cell"]] },
    ];
    for (const block of blocks) {
      expect(isContentBlock(block)).toBe(true);
    }
  });

  it("accepts code with newlines/backticks and rejects only completely empty code", () => {
    expect(isContentBlock({ type: "code", code: "```\na\n```\n" })).toBe(true);
    expect(isContentBlock({ type: "code", code: "" })).toBe(false);
    expect(isContentBlock({ type: "code", code: "x", language: "  " })).toBe(false);
  });

  it("rejects representative invalid payloads per type", () => {
    expect(isContentBlock({ type: "heading", level: 7, text: "x" })).toBe(false);
    expect(isContentBlock({ type: "heading", level: 0, text: "x" })).toBe(false);
    expect(isContentBlock({ type: "heading", level: 2, text: "   " })).toBe(false);
    expect(isContentBlock({ type: "paragraph", text: "" })).toBe(false);
    expect(isContentBlock({ type: "quote", text: "  " })).toBe(false);
    expect(isContentBlock({ type: "list", ordered: true, items: [] })).toBe(false);
    expect(isContentBlock({ type: "list", ordered: true, items: ["ok", "  "] })).toBe(false);
    expect(isContentBlock({ type: "list", items: ["no-ordered-field"] })).toBe(false);
    expect(isContentBlock({ type: "image", src: "javascript:alert(1)" })).toBe(false);
    expect(isContentBlock({ type: "image", src: "/relative.png" })).toBe(false);
    expect(isContentBlock({ type: "link", href: "javascript:alert(1)", text: "x" })).toBe(false);
    expect(isContentBlock({ type: "link", href: "https://example.com", text: "" })).toBe(false);
    expect(isContentBlock({ type: "table", rows: [] })).toBe(false);
    expect(isContentBlock({ type: "table", rows: [["a", "b"], ["c"]] })).toBe(false);
    expect(isContentBlock({ type: "table", headers: ["a"], rows: [["1", "2"]] })).toBe(false);
    expect(isContentBlock({ type: "unknown", text: "x" })).toBe(false);
    expect(isContentBlock(null)).toBe(false);
  });

  it("allows empty table cells but rejects extra keys", () => {
    expect(isContentBlock({ type: "table", rows: [["", "b"]] })).toBe(true);
    expect(isContentBlock({ type: "table", rows: [["a"]], colspan: 2 })).toBe(false);
  });
});

describe("NormalizedDocument", () => {
  it("accepts a valid document", () => {
    expect(isNormalizedDocument(makeDocument())).toBe(true);
  });

  it("rejects wrong schema versions", () => {
    const doc: unknown = { ...makeDocument(), schemaVersion: 2 };
    expect(isNormalizedDocument(doc)).toBe(false);
  });

  it("rejects empty blocks", () => {
    const doc: unknown = { ...makeDocument(), blocks: [] };
    expect(isNormalizedDocument(doc)).toBe(false);
  });

  it("rejects malformed source and metadata", () => {
    const badSource: unknown = { ...makeDocument(), source: { kind: "web", url: "javascript:x" } };
    expect(isNormalizedDocument(badSource)).toBe(false);
    const badMetadata: unknown = { ...makeDocument(), metadata: { title: "", capturedAt: "2026-08-30T00:00:00.000Z" } };
    expect(isNormalizedDocument(badMetadata)).toBe(false);
  });

  it("rejects unknown extra keys and malformed assets", () => {
    const extra: unknown = { ...makeDocument(), extra: true };
    expect(isNormalizedDocument(extra)).toBe(false);
    const badAsset: unknown = { ...makeDocument(), assets: [{ kind: "image", url: "data:image/png;base64,x" }] };
    expect(isNormalizedDocument(badAsset)).toBe(false);
  });

  it("does not mutate frozen documents during validation", () => {
    expect(isNormalizedDocument(Object.freeze(makeDocument()))).toBe(true);
  });
});

describe("Asset model", () => {
  it("validates image assets", () => {
    expect(isAsset({ kind: "image", url: "https://example.com/a.png", alt: "a" })).toBe(true);
    expect(isAsset({ kind: "image", url: "javascript:alert(1)" })).toBe(false);
    expect(isAsset({ kind: "image", url: "https://example.com/a.png", extra: 1 })).toBe(false);
  });

  it("collects deduplicated assets from blocks, first-seen order", () => {
    const blocks: ContentBlock[] = [
      { type: "paragraph", text: "intro" },
      { type: "image", src: "https://example.com/b.png", alt: "second" },
      { type: "image", src: "https://example.com/a.png", alt: "first" },
      { type: "image", src: "https://example.com/a.png", alt: "duplicate" },
    ];
    const assets = collectAssetsFromBlocks(blocks);
    expect(assets).toEqual([
      { kind: "image", url: "https://example.com/b.png", alt: "second" },
      { kind: "image", url: "https://example.com/a.png", alt: "first" },
    ]);
    expect(collectAssetsFromBlocks(blocks)).toEqual(assets); // deterministic
  });

  it("does not mutate frozen input blocks", () => {
    const blocks: readonly ContentBlock[] = Object.freeze([
      Object.freeze({ type: "image", src: "https://example.com/a.png", alt: "x" }),
    ]);
    expect(collectAssetsFromBlocks(blocks)).toEqual([
      { kind: "image", url: "https://example.com/a.png", alt: "x" },
    ]);
  });
});
