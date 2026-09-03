// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { TechnicalDocsExtractor } from "../../../../src/adapters/techdocs";
import { isNormalizedDocument, Page2AgentErrorCode } from "../../../../src/core";
import { loadHtml, makePageContext } from "../../../helpers/load-html-fixture";

const DOCS_URL = "https://docs.example.com/api/streaming/reference";
const BLOG_URL = "https://example.com/blog/streaming-api-tips";

function loadFixtureDoc(fileName: string, dir: string, url: string): Document {
  const html = readFileSync(resolve("fixtures", dir, fileName), "utf8");
  return new JSDOM(html, { url }).window.document;
}

async function extractAt(fileName: string, dir: string, url: string) {
  const extractor = new TechnicalDocsExtractor();
  return extractor.extract({
    context: makePageContext({ url, title: "Fixture" }),
    document: loadFixtureDoc(fileName, dir, url),
  });
}

describe("TechnicalDocsExtractor", () => {
  it("keeps the same URL eligibility as the generic adapter", () => {
    const extractor = new TechnicalDocsExtractor();
    expect(extractor.id).toBe("technical-docs");
    expect(extractor.canHandle(makePageContext({ url: "https://example.com/anything" }))).toBe(true);
    expect(extractor.canHandle(makePageContext({ url: "https://github.com/o/r/issues/1" }))).toBe(true);
    expect(extractor.canHandle(makePageContext({ url: "about:blank" }))).toBe(false);
  });

  it("extracts a documentation page with the technical-docs identity", async () => {
    const document = await extractAt("api-reference.html", "docs", DOCS_URL);
    expect(isNormalizedDocument(document)).toBe(true);
    expect(document.capture).toEqual({
      adapter: { id: "technical-docs", name: "Technical Documentation" },
      scope: "full-page",
    });
    expect(document.metadata.title).toBe("Streaming API Reference");
    const text = document.blocks
      .map((block) => (block.type === "heading" || block.type === "paragraph" ? block.text : ""))
      .join(" ");
    expect(text).toContain("Parameters");
    expect(text).toContain("Returns");
    expect(text).toContain("Pass your API key");
    expect(text).not.toContain("Search docs");
    const code = document.blocks.filter((block) => block.type === "code");
    expect(code.length).toBeGreaterThanOrEqual(2);
    const tables = document.blocks.filter((block) => block.type === "table");
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it("honestly falls back to the generic adapter on docs-like articles", async () => {
    const document = await extractAt("article-docs-like.html", "generic", BLOG_URL);
    expect(isNormalizedDocument(document)).toBe(true);
    expect(document.capture).toEqual({
      adapter: { id: "generic-article", name: "Generic Article" },
      scope: "full-page",
    });
    expect(document.metadata.title).toBe("Tips for consuming our streaming API");
  });

  it("fails cleanly on content-free pages", async () => {
    await expect(
      new TechnicalDocsExtractor().extract({
        context: makePageContext({ url: "https://example.com/empty" }),
        document: loadHtml("<!doctype html><html><head><title>t</title></head><body></body></html>"),
      }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.NO_CONTENT_FOUND });
  });
});
