// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createProductionRegistry } from "../../../../src/extension/content/content-capture";
import { makePageContext } from "../../../helpers/load-html-fixture";

/**
 * Adapter priority regression (V1.1): specific adapters must win over the
 * Technical Docs and Generic adapters purely from the URL. The Technical
 * Docs adapter intentionally shares the Generic URL eligibility (it decides
 * docs-vs-generic inside extract() and honestly records which pipeline ran),
 * so URL-only resolution for ordinary pages returns it — the classification
 * is verified by the extractor tests, not by registry order.
 */
describe("production extractor registry priority", () => {
  const registry = createProductionRegistry();

  it("resolves GitHub issues before any fallback", () => {
    const resolved = registry.resolve(
      makePageContext({ url: "https://github.com/acme/page2agent-demo/issues/42" }),
    );
    expect(resolved?.id).toBe("github-issue");
  });

  it("resolves GitHub pull requests before any fallback", () => {
    const resolved = registry.resolve(
      makePageContext({ url: "https://github.com/acme/page2agent-demo/pull/58" }),
    );
    expect(resolved?.id).toBe("github-pull-request");
  });

  it("never lets the generic fallback claim GitHub URLs", () => {
    const github = registry.resolve(
      makePageContext({ url: "https://github.com/acme/page2agent-demo/issues/1" }),
    );
    expect(github?.id).not.toBe("generic-article");
    expect(github?.id).not.toBe("technical-docs");
  });

  it("resolves ordinary pages to the docs-eligible adapter (extract decides)", () => {
    const resolved = registry.resolve(makePageContext({ url: "https://example.com/article" }));
    expect(resolved?.id).toBe("technical-docs");
  });
});
