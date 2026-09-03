// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GitHubPullRequestExtractor } from "../../../../src/adapters/github";
import { loadGitHubFixture, loadHtml, makePageContext } from "../../../helpers/load-html-fixture";
import { isNormalizedDocument, Page2AgentErrorCode } from "../../../../src/core";

const PR_FIXTURE_BASE_URL = "https://github.com/acme/page2agent-demo/pull/58";

async function extractFixture(fileName: string, url: string = PR_FIXTURE_BASE_URL) {
  const extractor = new GitHubPullRequestExtractor();
  return extractor.extract({
    context: makePageContext({ url, title: "Fixture" }),
    document: loadGitHubFixture(fileName, url),
  });
}

describe("GitHubPullRequestExtractor", () => {
  it("detects PR pages by URL only", () => {
    const extractor = new GitHubPullRequestExtractor();
    expect(extractor.id).toBe("github-pull-request");
    expect(
      extractor.canHandle(
        makePageContext({ url: "https://github.com/acme/page2agent-demo/pull/58" }),
      ),
    ).toBe(true);
    expect(
      extractor.canHandle(
        makePageContext({ url: "https://github.com/acme/page2agent-demo/issues/58" }),
      ),
    ).toBe(false);
    expect(extractor.canHandle(makePageContext())).toBe(false);
  });

  it("extracts identity, rendered-DOM facts, and the description body", async () => {
    const document = await extractFixture("pr-basic.html");
    expect(isNormalizedDocument(document)).toBe(true);
    expect(document.source).toMatchObject({
      kind: "github_pull_request",
      owner: "acme",
      repo: "page2agent-demo",
      prNumber: 58,
      state: "open",
      baseBranch: "main",
      headBranch: "fix/slow-ingest",
      labels: ["performance", "ingestion"],
    });
    expect(document.metadata).toMatchObject({
      title: "Fix slow image ingest",
      author: "ada",
      publishedAt: "2026-08-20T10:00:00.000Z",
    });
    expect(document.capture).toEqual({
      adapter: { id: "github-pull-request", name: "GitHub Pull Request" },
      scope: "full-page",
    });
  });

  it("keeps review comments out of the PR description", async () => {
    const document = await extractFixture("pr-basic.html");
    const text = document.blocks
      .map((block) =>
        block.type === "list" ? block.items.join(" ") : "text" in block ? block.text : "",
      )
      .join(" ");
    expect(text).toContain("Image-heavy pages take 100s+ to ingest");
    expect(text).not.toContain("CHANGELOG");
    expect(text).not.toContain("bob");
    expect(text).toContain("Summary");
    expect(text).toContain("Testing");
  });

  it("preserves code blocks and tables in the description", async () => {
    const document = await extractFixture("pr-basic.html");
    const code = document.blocks.find((block) => block.type === "code");
    expect(code).toBeDefined();
    if (code !== undefined && code.type === "code") {
      expect(code.code).toContain('image.decoding = "async"');
    }
    const table = document.blocks.find((block) => block.type === "table");
    expect(table).toBeDefined();
  });

  it("fails cleanly when the description body is missing", async () => {
    const html =
      "<html><body><h1 class='gh-header-title'>No body</h1><div class='site'></div></body></html>";
    await expect(
      new GitHubPullRequestExtractor().extract({
        context: makePageContext({ url: PR_FIXTURE_BASE_URL }),
        document: loadHtml(html, PR_FIXTURE_BASE_URL),
      }),
    ).rejects.toMatchObject({ code: Page2AgentErrorCode.NO_CONTENT_FOUND });
  });

  it("maps merged and closed state text deterministically", async () => {
    const mergedHtml = `<!doctype html><html><body>
      <h1 class="gh-header-title"><span class="js-issue-title">Merged PR</span></h1>
      <span class="State">Merged</span>
      <div class="comment-body markdown-body js-comment-body"><p>Landed.</p></div>
    </body></html>`;
    const merged = await new GitHubPullRequestExtractor().extract({
      context: makePageContext({ url: PR_FIXTURE_BASE_URL }),
      document: loadHtml(mergedHtml, PR_FIXTURE_BASE_URL),
    });
    expect(merged.source.kind).toBe("github_pull_request");
    if (merged.source.kind === "github_pull_request") {
      expect(merged.source.state).toBe("merged");
    }
  });

  it("ignores canonical URLs that point at a different PR identity", async () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://github.com/acme/page2agent-demo/pull/59">
    </head><body>
      <h1 class="gh-header-title"><span class="js-issue-title">Other PR</span></h1>
      <div class="comment-body markdown-body js-comment-body"><p>Body.</p></div>
    </body></html>`;
    const document = await new GitHubPullRequestExtractor().extract({
      context: makePageContext({ url: PR_FIXTURE_BASE_URL }),
      document: loadHtml(html, PR_FIXTURE_BASE_URL),
    });
    expect("canonicalUrl" in document.source).toBe(false);
  });
});
