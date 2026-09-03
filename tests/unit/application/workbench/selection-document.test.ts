import { describe, expect, it } from "vitest";
import {
  buildSelectionDocument,
  sourceDescriptorForUrl,
} from "../../../../src/application/workbench/selection-document";
import { isNormalizedDocument, Page2AgentErrorCode } from "../../../../src/core";

const BLOCKS = [
  { type: "heading", level: 2, text: "Authentication" },
  { type: "paragraph", text: "Bearer tokens over HTTPS." },
] as const;

describe("sourceDescriptorForUrl", () => {
  it("keeps GitHub issue and PR identity from the URL", () => {
    expect(sourceDescriptorForUrl("https://github.com/o/r/issues/12")).toMatchObject({
      kind: "github_issue",
      owner: "o",
      repo: "r",
      issueNumber: 12,
    });
    expect(sourceDescriptorForUrl("https://github.com/o/r/pull/7")).toMatchObject({
      kind: "github_pull_request",
      owner: "o",
      repo: "r",
      prNumber: 7,
    });
  });

  it("falls back to a web source descriptor", () => {
    expect(sourceDescriptorForUrl("https://example.com/page")).toEqual({
      kind: "web",
      url: "https://example.com/page",
    });
  });

  it("rejects unusable URLs", () => {
    expect(() => sourceDescriptorForUrl("about:blank")).toThrow();
  });
});

describe("buildSelectionDocument", () => {
  function base() {
    return {
      captureId: "capture-1",
      url: "https://example.com/article",
      capturedAt: "2026-09-01T00:00:00.000Z",
      title: "Authentication",
      adapterId: "context-lens" as const,
      scope: "selection" as const,
      blocks: [...BLOCKS],
    };
  }

  it("builds a validated selection fragment document", () => {
    const document = buildSelectionDocument(base());
    expect(isNormalizedDocument(document)).toBe(true);
    expect(document.capture).toEqual({
      adapter: { id: "context-lens", name: "Context Lens" },
      scope: "selection",
    });
    expect(document.source.kind).toBe("web");
    expect(document.assets).toEqual([]);
  });

  it("rejects empty picks", () => {
    expect(() => buildSelectionDocument({ ...base(), blocks: [] })).toThrowError(
      expect.objectContaining({ code: Page2AgentErrorCode.NO_CONTENT_FOUND }),
    );
  });

  it("rejects oversized picks without truncating", () => {
    const bigParagraph = { type: "paragraph", text: "x".repeat(501_000) } as const;
    expect(() =>
      buildSelectionDocument({ ...base(), blocks: [...BLOCKS, bigParagraph] }),
    ).toThrowError(
      expect.objectContaining({ code: Page2AgentErrorCode.CONTENT_TOO_LARGE }),
    );
  });

  it("accepts GitHub URLs and keeps the scope honest", () => {
    const document = buildSelectionDocument({
      ...base(),
      url: "https://github.com/o/r/pull/7",
      scope: "text-selection",
      adapterId: "github-issue",
    });
    expect(document.source.kind).toBe("github_pull_request");
    expect(document.capture?.scope).toBe("text-selection");
  });
});
