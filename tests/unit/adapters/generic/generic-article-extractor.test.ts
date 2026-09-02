// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ExtractorRegistry,
  isNormalizedDocument,
  Page2AgentError,
  Page2AgentErrorCode,
} from "../../../../src/core";
import { GenericArticleExtractor } from "../../../../src/adapters/generic";
import type { ContentBlock, ImageBlock, LinkBlock, NormalizedDocument } from "../../../../src/core";
import {
  FIXTURE_BASE_URL,
  FIXTURE_CAPTURED_AT,
  loadFixture,
  loadHtml,
  makePageContext,
} from "../../../helpers/load-html-fixture";

const extractor = new GenericArticleExtractor();

function onlyImageBlocks(blocks: ContentBlock[]): ImageBlock[] {
  return blocks.flatMap((block) => (block.type === "image" ? [block] : []));
}

function onlyLinkBlocks(blocks: ContentBlock[]): LinkBlock[] {
  return blocks.flatMap((block) => (block.type === "link" ? [block] : []));
}

async function extractFixture(
  fileName: string,
  contextUrl: string = FIXTURE_BASE_URL,
): Promise<{ document: NormalizedDocument; sourceDocument: Document }> {
  const sourceDocument = loadFixture(fileName, contextUrl);
  const document = await extractor.extract({
    context: makePageContext({ url: contextUrl }),
    document: sourceDocument,
  });
  return { document, sourceDocument };
}

describe("GenericArticleExtractor detection", () => {
  it("accepts http and https pages", () => {
    expect(extractor.canHandle(makePageContext({ url: "https://example.com/article" }))).toBe(
      true,
    );
    expect(extractor.canHandle(makePageContext({ url: "http://example.com/article" }))).toBe(true);
  });

  it("rejects restricted and unsupported schemes", () => {
    for (const url of [
      "chrome://settings",
      "edge://settings",
      "chrome-extension://abc/",
      "file:///C:/notes.html",
      "about:blank",
      "https://chromewebstore.google.com/detail/abc",
    ]) {
      expect(extractor.canHandle(makePageContext({ url }))).toBe(false);
    }
  });

  it("rejects malformed URLs without throwing", () => {
    expect(extractor.canHandle(makePageContext({ url: "not a url" }))).toBe(false);
  });
});

describe("GenericArticleExtractor basic article", () => {
  it("extracts a valid NormalizedDocument with article content only", async () => {
    const { document } = await extractFixture("article-basic.html");
    expect(isNormalizedDocument(document)).toBe(true);

    // Metadata / source.
    expect(document.metadata.title).toBe("Capturing Web Contexts for Coding Agents");
    expect(document.metadata.capturedAt).toBe(FIXTURE_CAPTURED_AT);
    expect(document.source.kind).toBe("web");
    expect(document.source.url).toBe(FIXTURE_BASE_URL);
    expect(document.source.canonicalUrl).toBe("https://blog.example.com/capturing-web-contexts");

    // Nav / header / aside / footer noise excluded.
    const allText = JSON.stringify(document.blocks);
    expect(allText).not.toContain("SuperWidget");
    expect(allText).not.toContain("© 2026");
    expect(allText).not.toContain("Page2Agent Blog");

    // Content preserved.
    expect(
      document.blocks.some(
        (block) =>
          block.type === "paragraph" &&
          block.text ===
            "When an agent works on an issue, it needs the page's semantic context, not a screenshot.",
      ),
    ).toBe(true);
    expect(
      document.blocks.some(
        (block) => block.type === "heading" && block.level === 2 && block.text === "Why structure matters",
      ),
    ).toBe(true);
    expect(
      document.blocks.some(
        (block) => block.type === "quote" && block.text === "Context is what turns a web page into agent-ready input.",
      ),
    ).toBe(true);

    // Lists.
    const lists = document.blocks.filter((block) => block.type === "list");
    expect(lists).toHaveLength(2);
    expect(lists[0]).toEqual({
      type: "list",
      ordered: false,
      items: ["Capture the page", "Extract the article", "Normalize into blocks"],
    });
    expect(lists[1]).toEqual({
      type: "list",
      ordered: true,
      items: ["Open the extension", "Click capture", "Copy the context"],
    });

    // Code with language hint.
    const codeBlocks = document.blocks.filter((block) => block.type === "code");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]).toEqual({
      type: "code",
      code: "function capture(page) {\n  return normalize(page.blocks);\n}",
      language: "js",
    });

    // Table.
    const tables = document.blocks.filter((block) => block.type === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0]).toEqual({
      type: "table",
      headers: ["Stage", "Output"],
      rows: [
        ["Capture", "PageContext"],
        ["Extract", "NormalizedDocument"],
      ],
    });

    // Assets: only article content images, deduplicated.
    expect(document.assets).toEqual([
      {
        kind: "image",
        url: "https://example.com/images/diagram.png",
        alt: "Capture pipeline diagram",
        title: "Pipeline",
      },
    ]);

    // Title deduplication: the leading heading identical to the title is
    // removed (Readability normalizes the article h1 to h2).
    expect(document.blocks[0]).toEqual({
      type: "paragraph",
      text: "When an agent works on an issue, it needs the page's semantic context, not a screenshot.",
    });
  });

  it("preserves block reading order", async () => {
    const { document } = await extractFixture("article-basic.html");
    const textOf = (block: ContentBlock): string => {
      if (block.type === "heading" || block.type === "paragraph" || block.type === "quote") {
        return block.text;
      }
      return "";
    };
    const indexOf = (text: string): number =>
      document.blocks.findIndex((block) => textOf(block) === text);
    const whyStructure = indexOf("Why structure matters");
    const examplePipeline = indexOf("An example pipeline");
    const captureLine = indexOf("Capture, extract, normalize, package, deliver.");
    expect(whyStructure).toBeGreaterThanOrEqual(0);
    expect(examplePipeline).toBeGreaterThan(whyStructure);
    expect(captureLine).toBeGreaterThan(examplePipeline);
  });

  it("appends inline link reference blocks after semantic text", async () => {
    const { document } = await extractFixture("article-basic.html");
    const links = onlyLinkBlocks(document.blocks);
    expect(links.some((link) => link.href === "https://example.com/docs/architecture")).toBe(true);
    expect(links.some((link) => link.href === "https://example.com/images/diagram.png")).toBe(
      true,
    );
    // Text preserved without Markdown syntax.
    const paragraphText = document.blocks
      .filter((block) => block.type === "paragraph")
      .map((block) => (block.type === "paragraph" ? block.text : ""));
    expect(paragraphText.some((text) => text === "Read the architecture docs for details.")).toBe(
      true,
    );
    // No Markdown link syntax in the domain model.
    expect(JSON.stringify(document.blocks)).not.toContain("](");
  });

  it("keeps a differently-worded leading heading (exact-match dedup only)", async () => {
    const sourceDocument = loadFixture("article-basic.html");
    const h1 = sourceDocument.querySelector("article h1");
    h1?.replaceChildren("A Totally Different Heading");
    const document = await extractor.extract({
      context: makePageContext(),
      document: sourceDocument,
    });
    expect(document.blocks[0]).toMatchObject({
      type: "heading",
      text: "A Totally Different Heading",
    });
  });
});

describe("GenericArticleExtractor metadata", () => {
  it("extracts author, canonical, publishedAt and site", async () => {
    const { document } = await extractFixture("article-metadata.html");
    expect(document.metadata.title).toBe("Doc Title From Title Tag");
    expect(document.metadata.author).toBe("Ada Lovelace");
    expect(document.metadata.publishedAt).toBe("2026-08-01T09:30:00.000Z");
    expect(document.source.canonicalUrl).toBe("https://blog.example.com/canonical-article");
    if (document.source.kind === "web") {
      expect(document.source.site).toBe("example.com");
    } else {
      expect.unreachable("expected a web source descriptor");
    }
  });

  it("prefers og:title when present", async () => {
    const sourceDocument = loadFixture("article-metadata.html");
    const meta = sourceDocument.createElement("meta");
    meta.setAttribute("property", "og:title");
    meta.setAttribute("content", "OG Override Title");
    sourceDocument.head?.appendChild(meta);
    const document = await extractor.extract({
      context: makePageContext(),
      document: sourceDocument,
    });
    expect(document.metadata.title).toBe("OG Override Title");
  });

  it("falls back to the URL hostname when no title source exists", async () => {
    const sourceDocument = loadFixture("article-metadata.html");
    sourceDocument.querySelector("title")?.remove();
    sourceDocument.querySelector("h1")?.remove();
    const document = await extractor.extract({
      context: makePageContext(),
      document: sourceDocument,
    });
    expect(document.metadata.title).toBe("example.com");
  });

  it("ignores invalid optional metadata without failing the document", async () => {
    const sourceDocument = loadFixture("article-metadata.html");
    sourceDocument
      .querySelector('link[rel="canonical"]')
      ?.setAttribute("href", "javascript:alert(1)");
    sourceDocument
      .querySelector('meta[property="article:published_time"]')
      ?.setAttribute("content", "yesterday");
    const document = await extractor.extract({
      context: makePageContext(),
      document: sourceDocument,
    });
    expect(document.source.canonicalUrl).toBeUndefined();
    expect(document.metadata.publishedAt).toBeUndefined();
    expect(isNormalizedDocument(document)).toBe(true);
  });
});

describe("GenericArticleExtractor source truth", () => {
  it("derives source.url from PageContext, not the document URL", async () => {
    // Load the fixture under a different document URL than the PageContext URL.
    const sourceDocument = loadFixture("article-basic.html", "https://other.example.com/different/path");
    const document = await extractor.extract({
      context: makePageContext(), // url = FIXTURE_BASE_URL
      document: sourceDocument,
    });
    expect(document.source.url).toBe(FIXTURE_BASE_URL);
    // Relative references are absolutized by Readability against the document
    // base (browser semantics; identical to the PageContext URL in real use),
    // then re-validated through the core URL policy.
    const images = onlyImageBlocks(document.blocks);
    expect(images[0].src).toBe("https://other.example.com/images/diagram.png");
  });
});

describe("GenericArticleExtractor mutation safety", () => {
  it("never mutates the original document", async () => {
    const sourceDocument = loadFixture("article-basic.html");
    const before = sourceDocument.documentElement.outerHTML;
    await extractor.extract({ context: makePageContext(), document: sourceDocument });
    expect(sourceDocument.documentElement.outerHTML).toBe(before);
  });
});

describe("GenericArticleExtractor malicious HTML", () => {
  it("excludes scripts, event handlers and unsafe URLs; preserves safe text", async () => {
    const sourceDocument = loadFixture("article-malicious.html");
    const window = sourceDocument.defaultView;
    const document = await extractor.extract({
      context: makePageContext(),
      document: sourceDocument,
    });

    // No script executed while loading the fixture.
    if (window !== null) {
      expect("__PAGE2AGENT_SCRIPT_RAN__" in window).toBe(false);
      expect("__PAGE2AGENT_HANDLER_RAN__" in window).toBe(false);
      expect("__PAGE2AGENT_IMG_RAN__" in window).toBe(false);
    }

    expect(isNormalizedDocument(document)).toBe(true);
    const allText = JSON.stringify(document.blocks);
    expect(allText).not.toContain("alert(");
    expect(allText).not.toContain("vbscript");
    expect(allText).not.toContain("data:text/html");

    // No unsafe URLs survive in links or images.
    for (const link of onlyLinkBlocks(document.blocks)) {
      expect(link.href.startsWith("https://") || link.href.startsWith("http://")).toBe(true);
    }
    expect(onlyImageBlocks(document.blocks)).toHaveLength(0);

    // Safe visible text is preserved, including text around unsafe anchors.
    expect(
      document.blocks.some(
        (block) => block.type === "paragraph" && block.text === "Safe visible text in a paragraph.",
      ),
    ).toBe(true);
    expect(
      document.blocks.some(
        (block) => block.type === "paragraph" && block.text === "Read the dangerous link carefully.",
      ),
    ).toBe(true);
  });
});

describe("GenericArticleExtractor failure modes", () => {
  it("throws NO_CONTENT_FOUND for pages without meaningful content", async () => {
    const sourceDocument = loadFixture("article-no-content.html");
    await expect(
      extractor.extract({ context: makePageContext(), document: sourceDocument }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.NO_CONTENT_FOUND });
  });

  it("throws CONTENT_TOO_LARGE above the 500k limit and accepts exactly at it", async () => {
    const makeHtml = (paragraphCount: number, paragraphLength: number): string => {
      const paragraphs = Array.from(
        { length: paragraphCount },
        () => `<p>${"a".repeat(paragraphLength)}</p>`,
      ).join("\n");
      return `<!doctype html><html><head><title>Size fixture</title></head><body><article><h1>Size fixture</h1>${paragraphs}</article></body></html>`;
    };

    const atLimit = await extractor.extract({
      context: makePageContext(),
      document: loadHtml(makeHtml(10, 50_000)),
    });
    expect(isNormalizedDocument(atLimit)).toBe(true);

    await expect(
      extractor.extract({
        context: makePageContext(),
        document: loadHtml(makeHtml(11, 50_000)),
      }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.CONTENT_TOO_LARGE });
  });

  it("fails with structured Page2AgentError instances", async () => {
    const sourceDocument = loadFixture("article-no-content.html");
    try {
      await extractor.extract({ context: makePageContext(), document: sourceDocument });
      expect.unreachable("expected NO_CONTENT_FOUND");
    } catch (error) {
      expect(error).toBeInstanceOf(Page2AgentError);
      expect((error as Page2AgentError).code).toBe(Page2AgentErrorCode.NO_CONTENT_FOUND);
    }
  });
});

describe("GenericArticleExtractor registry integration", () => {
  it("resolves as the fallback extractor for ordinary web pages", () => {
    const registry = new ExtractorRegistry([extractor]);
    expect(registry.resolve(makePageContext())).toBe(extractor);
    expect(registry.resolve(makePageContext({ url: "https://example.com/any" }))).toBe(extractor);
  });

  it("is not selected for restricted pages", () => {
    const registry = new ExtractorRegistry([extractor]);
    expect(registry.resolve(makePageContext({ url: "chrome://settings" }))).toBeNull();
    expect(registry.resolve(makePageContext({ url: "file:///C:/x.html" }))).toBeNull();
  });
});
