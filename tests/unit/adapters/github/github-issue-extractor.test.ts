// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GenericArticleExtractor } from "../../../../src/adapters/generic";
import {
  extractSourceAcceptanceCriteria,
  GitHubIssueExtractor,
} from "../../../../src/adapters/github";
import {
  ExtractorRegistry,
  isNormalizedDocument,
  Page2AgentError,
  Page2AgentErrorCode,
} from "../../../../src/core";
import type { ContentBlock, ImageBlock, LinkBlock, NormalizedDocument } from "../../../../src/core";
import {
  FIXTURE_CAPTURED_AT,
  GITHUB_FIXTURE_BASE_URL,
  loadGitHubFixture,
  loadHtml,
  makePageContext,
} from "../../../helpers/load-html-fixture";

const extractor = new GitHubIssueExtractor();

async function extractFixture(
  fileName: string,
  contextUrl: string = GITHUB_FIXTURE_BASE_URL,
): Promise<NormalizedDocument> {
  const sourceDocument = loadGitHubFixture(fileName, contextUrl);
  return extractor.extract({ context: makePageContext({ url: contextUrl }), document: sourceDocument });
}

function onlyImageBlocks(blocks: ContentBlock[]): ImageBlock[] {
  return blocks.flatMap((block) => (block.type === "image" ? [block] : []));
}

function onlyLinkBlocks(blocks: ContentBlock[]): LinkBlock[] {
  return blocks.flatMap((block) => (block.type === "link" ? [block] : []));
}

describe("GitHubIssueExtractor detection", () => {
  it("accepts valid issue URLs and rejects everything else", () => {
    expect(extractor.canHandle(makePageContext({ url: GITHUB_FIXTURE_BASE_URL }))).toBe(true);
    expect(
      extractor.canHandle(
        makePageContext({ url: "https://github.com/a/b/issues/1?tab=comments" }),
      ),
    ).toBe(true);
    expect(
      extractor.canHandle(makePageContext({ url: "https://github.com/a/b/pull/123" })),
    ).toBe(false);
    expect(extractor.canHandle(makePageContext({ url: "https://github.com/a/b/issues" }))).toBe(
      false,
    );
    expect(
      extractor.canHandle(makePageContext({ url: "https://github.com.evil.example/a/b/issues/1" })),
    ).toBe(false);
    expect(extractor.canHandle(makePageContext({ url: "http://github.com/a/b/issues/1" }))).toBe(
      false,
    );
    expect(extractor.canHandle(makePageContext({ url: "https://example.com/a" }))).toBe(false);
  });
});

describe("GitHubIssueExtractor issue facts", () => {
  it("extracts identity, title, labels, author, times and canonical from the basic fixture", async () => {
    const document = await extractFixture("issue-basic.html");
    expect(isNormalizedDocument(document)).toBe(true);

    expect(document.source.kind).toBe("github_issue");
    if (document.source.kind === "github_issue") {
      expect(document.source.owner).toBe("acme");
      expect(document.source.repo).toBe("page2agent-demo");
      expect(document.source.issueNumber).toBe(123);
      expect(document.source.url).toBe(GITHUB_FIXTURE_BASE_URL);
      expect(document.source.canonicalUrl).toBe(GITHUB_FIXTURE_BASE_URL);
      expect(document.source.labels).toEqual(["bug", "extension"]);
    } else {
      expect.unreachable("expected github_issue source");
    }

    expect(document.metadata.title).toBe("Fix capture state regression");
    expect(document.metadata.author).toBe("ada");
    expect(document.metadata.publishedAt).toBe("2026-08-15T09:00:00.000Z");
    expect(document.metadata.capturedAt).toBe(FIXTURE_CAPTURED_AT);
  });

  it("preserves body content in source order and excludes repo/header UI", async () => {
    const document = await extractFixture("issue-basic.html");
    const texts = document.blocks.flatMap((block) =>
      block.type === "paragraph" || block.type === "heading" || block.type === "quote"
        ? [block.text]
        : [],
    );

    expect(texts[0]).toBe("The side panel shows stale capture results after a second capture.");
    expect(texts).toContain("Steps to reproduce");
    expect(texts).toContain("Only reproducible in Chrome.");

    const lists = document.blocks.filter((block) => block.type === "list");
    expect(lists).toContainEqual({
      type: "list",
      ordered: true,
      items: ["Open the demo repo", "Run a capture"],
    });
    expect(lists).toContainEqual({ type: "list", ordered: false, items: ["No comments yet"] });

    const codeBlocks = document.blocks.filter((block) => block.type === "code");
    expect(codeBlocks).toEqual([
      { type: "code", code: "const result = capture();", language: "js" },
    ]);

    const images = onlyImageBlocks(document.blocks);
    expect(images).toEqual([
      {
        type: "image",
        src: "https://user-images.githubusercontent.com/123/example.png",
        alt: "stale panel",
      },
    ]);

    const tables = document.blocks.filter((block) => block.type === "table");
    expect(tables).toEqual([
      { type: "table", headers: ["Capture", "Result"], rows: [["First", "OK"]] },
    ]);

    // Repo header / page chrome excluded.
    expect(JSON.stringify(document.blocks)).not.toContain("repo-header");
    expect(JSON.stringify(document.blocks)).not.toContain("opened this issue");

    // Inline link references.
    const links = onlyLinkBlocks(document.blocks);
    expect(links).toContainEqual({
      type: "link",
      href: "https://github.com/acme/page2agent-demo",
      text: "the demo repo",
    });

    // Assets collected from content blocks only.
    expect(document.assets).toEqual([
      {
        kind: "image",
        url: "https://user-images.githubusercontent.com/123/example.png",
        alt: "stale panel",
      },
    ]);
  });

  it("derives identity from the PageContext URL and ignores DOM identity", async () => {
    const contextUrl = "https://github.com/other/thing/issues/999";
    const document = await extractFixture("issue-basic.html", contextUrl);
    if (document.source.kind === "github_issue") {
      expect(document.source.owner).toBe("other");
      expect(document.source.repo).toBe("thing");
      expect(document.source.issueNumber).toBe(999);
      // Canonical points at a different issue → ignored.
      expect(document.source.canonicalUrl).toBeUndefined();
    } else {
      expect.unreachable("expected github_issue source");
    }
    // Title still comes from the DOM issue-specific region.
    expect(document.metadata.title).toBe("Fix capture state regression");
  });

  it("extracts the same core facts from the fallback DOM shape", async () => {
    const document = await extractFixture("issue-fallback.html");
    expect(document.metadata.title).toBe("Fallback Issue Title");
    expect(document.metadata.author).toBe("ada");
    expect(document.metadata.publishedAt).toBe("2026-08-15T09:00:00.000Z");
    if (document.source.kind === "github_issue") {
      expect(document.source.labels).toBeUndefined();
      expect(document.source.canonicalUrl).toBeUndefined();
    }
    expect(
      document.blocks.some(
        (block) =>
          block.type === "paragraph" && block.text === "Fallback body paragraph with related issue.",
      ),
    ).toBe(true);
    expect(onlyLinkBlocks(document.blocks)).toContainEqual({
      type: "link",
      href: "https://github.com/acme/page2agent-demo/issues/456",
      text: "related issue",
    });
  });

  it("extracts the current data-testid GitHub issue DOM without including comments", async () => {
    const document = await extractFixture("issue-modern.html");
    expect(document.metadata.title).toBe("Modern issue title");
    expect(document.metadata.author).toBe("Ada (ada)");
    expect(document.metadata.publishedAt).toBe("2026-08-15T09:00:00.000Z");
    expect(JSON.stringify(document.blocks)).toContain("Modern source body.");
    expect(JSON.stringify(document.blocks)).not.toContain("This comment must stay excluded");
    expect(extractSourceAcceptanceCriteria(document.blocks)).toEqual([
      "Use stable semantic selectors",
    ]);
    if (document.source.kind === "github_issue") {
      expect(document.source.labels).toEqual(["bug", "regression"]);
    } else {
      expect.unreachable("expected github_issue source");
    }
  });
});

describe("GitHubIssueExtractor comments and timeline exclusion", () => {
  it("never includes comments or timeline noise in the document", async () => {
    const document = await extractFixture("issue-with-comment.html");
    const allText = JSON.stringify(document.blocks);
    expect(allText).not.toContain("Add tests");
    expect(allText).not.toContain("This comment must never be extracted");
    expect(allText).not.toContain("added the bug label");
    expect(allText).not.toContain("closed this issue");
    expect(
      document.blocks.some(
        (block) => block.type === "paragraph" && block.text === "The panel shows stale results.",
      ),
    ).toBe(true);

    // The comment's AC section must NOT become source acceptance criteria.
    expect(extractSourceAcceptanceCriteria(document.blocks)).toBeNull();
  });
});

describe("GitHubIssueExtractor source acceptance criteria", () => {
  it("extracts explicit task-list AC and keeps the section in the document", async () => {
    const document = await extractFixture("issue-with-acceptance-criteria.html");
    const criteria = extractSourceAcceptanceCriteria(document.blocks);
    expect(criteria).toEqual([
      "[x] Latest capture wins",
      "[ ] Existing content is preserved",
    ]);

    // The AC section remains in the source document (never deleted).
    expect(
      document.blocks.some(
        (block) => block.type === "heading" && block.text === "Acceptance Criteria",
      ),
    ).toBe(true);
    expect(
      document.blocks.some(
        (block) => block.type === "paragraph" && block.text === "Do not change unrelated UI.",
      ),
    ).toBe(true);
  });

  it("returns null when the issue has no explicit AC", async () => {
    const document = await extractFixture("issue-without-acceptance-criteria.html");
    expect(extractSourceAcceptanceCriteria(document.blocks)).toBeNull();
  });

  it("never invents engineering requirements for a bare issue", async () => {
    const sourceDocument = loadGitHubFixture("issue-basic.html");
    const paragraph = sourceDocument.createElement("p");
    paragraph.textContent = "App crashes when deleting an agent.";
    sourceDocument.querySelector(".js-comment-body")?.replaceChildren(paragraph);
    const document = await extractor.extract({
      context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }),
      document: sourceDocument,
    });
    const criteria = extractSourceAcceptanceCriteria(document.blocks);
    expect(criteria).toBeNull();
    const allText = JSON.stringify(document.blocks).toLowerCase();
    expect(allText).not.toContain("add regression tests");
    expect(allText).not.toContain("fix concurrency");
    expect(allText).not.toContain("update docs");
  });
});

describe("GitHubIssueExtractor task lists and code", () => {
  it("preserves task-list state in body blocks", async () => {
    const document = await extractFixture("issue-task-list.html");
    const lists = document.blocks.filter((block) => block.type === "list");
    expect(lists[0]).toEqual({
      type: "list",
      ordered: false,
      items: ["[x] reproduce issue", "[ ] verify Chrome"],
    });
  });

  it("preserves modern GitHub task-list fidelity without accessibility UI", async () => {
    const sourceDocument = loadGitHubFixture("issue-modern-task-list.html");
    const before = sourceDocument.documentElement.outerHTML;
    const document = await extractor.extract({
      context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }),
      document: sourceDocument,
    });
    const lists = document.blocks.filter((block) => block.type === "list");

    expect(lists[0]).toEqual({
      type: "list",
      ordered: false,
      items: [
        "[x] I have searched the existing issues and this bug is not already filed.",
        "[x] I believe this is a legitimate bug, not just a question or feature request.",
      ],
    });
    expect(lists[0]?.items).toHaveLength(2);
    expect(lists[1]).toEqual({
      type: "list",
      ordered: false,
      items: ["Plain unordered list text."],
    });
    expect(JSON.stringify(document.blocks)).not.toContain("To pick up a draggable item");
    expect(JSON.stringify(document.blocks)).not.toContain("While dragging");
    expect(JSON.stringify(document.blocks)).not.toContain("Press space again to drop");
    expect(JSON.stringify(document.blocks)).not.toContain("press escape to cancel");
    expect(extractSourceAcceptanceCriteria(document.blocks)).toBeNull();
    expect(JSON.stringify(document.blocks)).not.toContain(
      "This comment must stay excluded from the issue body.",
    );
    expect(sourceDocument.documentElement.outerHTML).toBe(before);
  });

  it("preserves code with language hints and without copy UI", async () => {
    const document = await extractFixture("issue-code.html");
    const codeBlocks = document.blocks.filter((block) => block.type === "code");
    expect(codeBlocks).toEqual([
      {
        type: "code",
        code: 'def reproduce():\n    print("```")',
        language: "python",
      },
      { type: "code", code: "- old line\n+ new line", language: "diff" },
    ]);
  });
});

describe("GitHubIssueExtractor malicious HTML", () => {
  it("keeps safe text only; never extracts scripts or unsafe URLs", async () => {
    const sourceDocument = loadGitHubFixture("issue-malicious.html");
    const window = sourceDocument.defaultView;
    const document = await extractor.extract({
      context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }),
      document: sourceDocument,
    });

    if (window !== null) {
      expect("__PAGE2AGENT_GITHUB_SCRIPT_RAN__" in window).toBe(false);
      expect("__PAGE2AGENT_GITHUB_HANDLER_RAN__" in window).toBe(false);
    }

    expect(isNormalizedDocument(document)).toBe(true);
    const allText = JSON.stringify(document.blocks);
    expect(allText).not.toContain("alert(");
    expect(allText).not.toContain("data:image");
    expect(onlyLinkBlocks(document.blocks)).toHaveLength(0);
    expect(onlyImageBlocks(document.blocks)).toHaveLength(0);
    expect(
      document.blocks.some(
        (block) => block.type === "paragraph" && block.text === "Safe visible text.",
      ),
    ).toBe(true);
    expect(
      document.blocks.some(
        (block) => block.type === "paragraph" && block.text === "Text with handler.",
      ),
    ).toBe(true);
  });
});

describe("GitHubIssueExtractor failure modes", () => {
  it("throws NO_CONTENT_FOUND for empty or sentinel-only bodies", async () => {
    await expect(extractFixture("issue-empty-body.html")).rejects.toMatchObject({
      code: Page2AgentErrorCode.NO_CONTENT_FOUND,
    });

    // Truly empty body (no UI sentinel either).
    const sourceDocument = loadGitHubFixture("issue-empty-body.html");
    sourceDocument.querySelector(".js-comment-body")?.replaceChildren();
    await expect(
      extractor.extract({ context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }), document: sourceDocument }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.NO_CONTENT_FOUND });
  });

  it("throws UNSUPPORTED_PAGE when extract is forced on a non-issue URL", async () => {
    const sourceDocument = loadHtml("<!doctype html><html><body></body></html>");
    await expect(
      extractor.extract({
        context: makePageContext({ url: "https://blog.example.com/post" }),
        document: sourceDocument,
      }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.UNSUPPORTED_PAGE });
  });

  it("throws CONTENT_TOO_LARGE above the 500k limit and accepts exactly at it", async () => {
    const makeHtml = (paragraphCount: number, paragraphLength: number): string => {
      const paragraphs = Array.from(
        { length: paragraphCount },
        () => `<p>${"a".repeat(paragraphLength)}</p>`,
      ).join("\n");
      return (
        "<!doctype html><html><head><title>x</title></head><body>" +
        '<div class="gh-header"><div class="gh-header-title"><bdi class="js-issue-title">Huge body</bdi></div></div>' +
        '<div class="js-timeline-item"><div class="timeline-comment"><div class="comment-body markdown-body js-comment-body">' +
        paragraphs +
        "</div></div></div></body></html>"
      );
    };

    const atLimit = await extractor.extract({
      context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }),
      document: loadHtml(makeHtml(10, 50_000), GITHUB_FIXTURE_BASE_URL),
    });
    expect(isNormalizedDocument(atLimit)).toBe(true);

    await expect(
      extractor.extract({
        context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }),
        document: loadHtml(makeHtml(11, 50_000), GITHUB_FIXTURE_BASE_URL),
      }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.CONTENT_TOO_LARGE });
  });

  it("fails with structured Page2AgentError instances", async () => {
    try {
      await extractFixture("issue-empty-body.html");
      expect.unreachable("expected NO_CONTENT_FOUND");
    } catch (error) {
      expect(error).toBeInstanceOf(Page2AgentError);
      expect((error as Page2AgentError).code).toBe(Page2AgentErrorCode.NO_CONTENT_FOUND);
    }
  });
});

describe("GitHubIssueExtractor mutation safety", () => {
  it("never mutates the original document", async () => {
    const sourceDocument = loadGitHubFixture("issue-with-acceptance-criteria.html");
    const before = sourceDocument.documentElement.outerHTML;
    await extractor.extract({
      context: makePageContext({ url: GITHUB_FIXTURE_BASE_URL }),
      document: sourceDocument,
    });
    expect(sourceDocument.documentElement.outerHTML).toBe(before);
  });
});

describe("GitHub-over-Generic registry priority", () => {
  it("resolves GitHub issues to github-issue and ordinary pages to generic-article", () => {
    const registry = new ExtractorRegistry([
      extractor,
      new GenericArticleExtractor(),
    ]);
    expect(registry.resolve(makePageContext({ url: GITHUB_FIXTURE_BASE_URL }))?.id).toBe(
      "github-issue",
    );
    expect(registry.resolve(makePageContext({ url: "https://blog.example.com/post" }))?.id).toBe(
      "generic-article",
    );
  });
});
