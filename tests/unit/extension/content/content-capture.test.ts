// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createProductionRegistry,
  handleContentCaptureRequest,
} from "../../../../src/extension/content/content-capture";
import {
  loadFixture,
  loadGitHubFixture,
  makePageContext,
} from "../../../helpers/load-html-fixture";
import { ExtractorRegistry } from "../../../../src/core";
import { GitHubIssueExtractor } from "../../../../src/adapters/github";
import { GenericArticleExtractor } from "../../../../src/adapters/generic";

const GITHUB_CONTEXT_URL = "https://github.com/acme/page2agent-demo/issues/42";

function makeDeps(overrides: Partial<Parameters<typeof handleContentCaptureRequest>[1]> = {}) {
  return {
    locationHref: () => "https://example.com/docs/page",
    document: loadFixture("article-basic.html"),
    registry: createProductionRegistry(),
    ...overrides,
  };
}

describe("production registry selection", () => {
  it("resolves GitHub issues to github-issue and web pages to generic-article", () => {
    const registry = createProductionRegistry();
    expect(
      registry.resolve(makePageContext({ url: GITHUB_CONTEXT_URL }))?.id,
    ).toBe("github-issue");
    expect(
      registry.resolve(makePageContext({ url: "https://example.com/docs/page" }))?.id,
    ).toBe("generic-article");
  });

  it("has a unique, stable extractor id set", () => {
    const registry = new ExtractorRegistry([new GitHubIssueExtractor(), new GenericArticleExtractor()]);
    expect(registry.resolve(makePageContext({ url: GITHUB_CONTEXT_URL }))?.id).toBe("github-issue");
  });
});

describe("handleContentCaptureRequest — generic", () => {
  it("extracts a generic article into a validated NormalizedDocument", async () => {
    const response = await handleContentCaptureRequest(
      {
        type: "content.capture.request",
        context: makePageContext(),
      },
      makeDeps(),
    );
    expect(response.type).toBe("content.capture.success");
    if (response.type === "content.capture.success") {
      expect(response.captureId).toBe("11111111-1111-4111-8111-111111111111");
      expect(response.document.source.kind).toBe("web");
      expect(response.document.blocks.length).toBeGreaterThan(0);
    }
  });
});

describe("handleContentCaptureRequest — github", () => {
  it("extracts a GitHub issue into a github_issue document", async () => {
    const response = await handleContentCaptureRequest(
      {
        type: "content.capture.request",
        context: makePageContext({
          url: GITHUB_CONTEXT_URL,
          title: "Fix deletion crash",
          tabId: 9,
        }),
      },
      {
        locationHref: () => GITHUB_CONTEXT_URL,
        document: loadGitHubFixture("issue-with-acceptance-criteria.html", GITHUB_CONTEXT_URL),
        registry: createProductionRegistry(),
      },
    );
    expect(response.type).toBe("content.capture.success");
    if (response.type === "content.capture.success") {
      expect(response.document.source.kind).toBe("github_issue");
      expect(response.document.metadata.title).toBe("Fix deletion crash");
    }
  });
});

describe("handleContentCaptureRequest — navigation and validation", () => {
  it("rejects with PAGE_NAVIGATED when the URL differs before extraction", async () => {
    const response = await handleContentCaptureRequest(
      { type: "content.capture.request", context: makePageContext() },
      makeDeps({ locationHref: () => "https://other.example.com/nowhere" }),
    );
    expect(response).toMatchObject({ type: "content.capture.failure", error: { code: "PAGE_NAVIGATED" } });
  });

  it("rejects with PAGE_NAVIGATED when the URL changes after extraction", async () => {
    let calls = 0;
    const response = await handleContentCaptureRequest(
      { type: "content.capture.request", context: makePageContext() },
      makeDeps({
        locationHref: () => {
          calls += 1;
          return calls === 1 ? "https://example.com/docs/page" : "https://example.com/moved";
        },
      }),
    );
    expect(response).toMatchObject({ type: "content.capture.failure", error: { code: "PAGE_NAVIGATED" } });
  });

  it("rejects malformed messages with INVALID_MESSAGE", async () => {
    const response = await handleContentCaptureRequest(
      { type: "content.capture.request", context: { ...makePageContext(), captureId: "" } },
      makeDeps(),
    );
    expect(response).toMatchObject({ type: "content.capture.failure", error: { code: "INVALID_MESSAGE" } });
    const unknown = await handleContentCaptureRequest("garbage", makeDeps());
    expect(unknown).toMatchObject({ type: "content.capture.failure", error: { code: "INVALID_MESSAGE" } });
  });

  it("returns UNSUPPORTED_PAGE when no extractor matches", async () => {
    const emptyRegistry = new ExtractorRegistry([]);
    const response = await handleContentCaptureRequest(
      { type: "content.capture.request", context: makePageContext() },
      makeDeps({ registry: emptyRegistry }),
    );
    expect(response).toMatchObject({ type: "content.capture.failure", error: { code: "UNSUPPORTED_PAGE" } });
  });

  it("maps unexpected extractor errors to CAPTURE_FAILED without stacks", async () => {
    const brokenRegistry = new ExtractorRegistry([
      {
        id: "broken",
        canHandle: () => true,
        extract: async () => {
          throw new Error("raw internal detail");
        },
      },
    ]);
    const response = await handleContentCaptureRequest(
      { type: "content.capture.request", context: makePageContext() },
      makeDeps({ registry: brokenRegistry }),
    );
    expect(response).toMatchObject({ type: "content.capture.failure", error: { code: "CAPTURE_FAILED" } });
    if (response.type === "content.capture.failure") {
      expect(response.error.message).not.toContain("raw internal detail");
    }
  });
});
