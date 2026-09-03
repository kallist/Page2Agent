// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { assessDocsKind } from "../../../../src/adapters/techdocs";
import { loadGitHubFixture, loadHtml } from "../../../helpers/load-html-fixture";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const DOCS_URL = "https://docs.example.com/api/streaming/reference";
const BLOG_URL = "https://example.com/blog/streaming-api-tips";

function loadDoc(fileName: string, dir: string, url: string): Document {
  const html = readFileSync(resolve("fixtures", dir, fileName), "utf8");
  return new JSDOM(html, { url }).window.document;
}

describe("assessDocsKind", () => {
  it("classifies a real-style API reference page as docs", () => {
    const assessment = assessDocsKind(loadDoc("api-reference.html", "docs", DOCS_URL), DOCS_URL);
    expect(assessment.isDocs).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(4);
    expect(assessment.signals.positive).toEqual(
      expect.arrayContaining(["docusaurus theme marker", "docs search chrome", "reference heading vocabulary"]),
    );
  });

  it("leaves an engineering blog article generic (false-positive guard)", () => {
    const assessment = assessDocsKind(loadDoc("article-docs-like.html", "generic", BLOG_URL), BLOG_URL);
    expect(assessment.isDocs).toBe(false);
    expect(assessment.signals.negative).toEqual(
      expect.arrayContaining(["blog URL path", "article/og:type markers"]),
    );
  });

  it("rejects thin pages with no structure", () => {
    const assessment = assessDocsKind(loadHtml("<html><body><p>Hi</p></body></html>"), "https://example.com/");
    expect(assessment.isDocs).toBe(false);
    expect(assessment.signals.negative).toContain("thin page");
  });

  it("is deterministic for the same DOM", () => {
    const document = loadDoc("api-reference.html", "docs", DOCS_URL);
    expect(assessDocsKind(document, DOCS_URL)).toEqual(assessDocsKind(document, DOCS_URL));
  });

  it("does not classify a GitHub issue page as docs", () => {
    const document = loadGitHubFixture("issue-basic.html");
    const assessment = assessDocsKind(document, "https://github.com/o/r/issues/1");
    expect(assessment.isDocs).toBe(false);
  });

  it("does not classify a marketing landing page with code as docs", () => {
    const html = `<!doctype html><html><head>
      <meta property="og:type" content="website">
    </head><body>
      <header><nav><a href="/">Product</a><a href="/pricing">Pricing</a></nav></header>
      <main>
        <h1>Fast widgets for teams</h1>
        <h2>Integrate in minutes</h2>
        <pre><code>npm install fast-widgets</code></pre>
        <p>Trusted by 2,000 teams. Start free, no credit card required.
           Our widgets render at 60fps and include analytics, theming and
           enterprise support with a 99.9% SLA.</p>
      </main>
    </body></html>`;
    const assessment = assessDocsKind(loadHtml(html), "https://example.com/");
    expect(assessment.isDocs).toBe(false);
  });
});
