import { describe, expect, it } from "vitest";
import {
  GITHUB_PULL_REQUEST_SOURCE_KIND,
  GITHUB_PULL_REQUEST_STATES,
  isGitHubPullRequestSourceDescriptor,
  isGitHubPullRequestState,
  isNormalizedDocument,
  isSourceDescriptor,
} from "../../../src/core";
import type { NormalizedDocument } from "../../../src/core";
import { makeWebDocument } from "../../helpers/workbench-fixtures";

describe("V1.1 source kinds", () => {
  it("registers github_pull_request as a source descriptor kind", () => {
    const descriptor = {
      kind: GITHUB_PULL_REQUEST_SOURCE_KIND,
      url: "https://github.com/o/r/pull/99",
      canonicalUrl: "https://github.com/o/r/pull/99",
      owner: "o",
      repo: "r",
      prNumber: 99,
    };
    expect(isSourceDescriptor(descriptor)).toBe(true);
    expect(isGitHubPullRequestSourceDescriptor(descriptor)).toBe(true);
  });

  it("accepts optional rendered-DOM facts when present", () => {
    const descriptor = {
      kind: GITHUB_PULL_REQUEST_SOURCE_KIND,
      url: "https://github.com/o/r/pull/99",
      owner: "o",
      repo: "r",
      prNumber: 99,
      labels: ["bug"],
      state: "merged",
      baseBranch: "main",
      headBranch: "feature/x",
    };
    expect(isGitHubPullRequestSourceDescriptor(descriptor)).toBe(true);
  });

  it("rejects invented or malformed PR facts", () => {
    const base = {
      kind: GITHUB_PULL_REQUEST_SOURCE_KIND,
      url: "https://github.com/o/r/pull/99",
      owner: "o",
      repo: "r",
      prNumber: 99,
    };
    expect(isGitHubPullRequestSourceDescriptor({ ...base, state: "drafty" })).toBe(false);
    expect(isGitHubPullRequestSourceDescriptor({ ...base, prNumber: 0 })).toBe(false);
    expect(isGitHubPullRequestSourceDescriptor({ ...base, extra: 1 })).toBe(false);
    expect(isGitHubPullRequestState("open")).toBe(true);
    expect(isGitHubPullRequestState("merged")).toBe(true);
    expect(isGitHubPullRequestState("closed")).toBe(true);
    expect(isGitHubPullRequestState("reopened")).toBe(false);
    expect([...GITHUB_PULL_REQUEST_STATES]).toEqual(["open", "closed", "merged"]);
  });
});

describe("V1.1 capture provenance on NormalizedDocument", () => {
  it("accepts documents with adapter + scope metadata", () => {
    const document = makeWebDocument({
      capture: {
        adapter: { id: "technical-docs", name: "Technical Documentation" },
        scope: "full-page",
      },
    });
    expect(isNormalizedDocument(document)).toBe(true);
  });

  it("accepts legacy documents without capture metadata", () => {
    const document = makeWebDocument();
    delete (document as { capture?: unknown }).capture;
    expect(isNormalizedDocument(document)).toBe(true);
  });

  it("rejects unknown adapters, wrong names, and unknown scopes", () => {
    const base = makeWebDocument();
    expect(
      isNormalizedDocument({
        ...base,
        capture: { adapter: { id: "unknown-adapter", name: "X" }, scope: "full-page" },
      }),
    ).toBe(false);
    expect(
      isNormalizedDocument({
        ...base,
        capture: { adapter: { id: "generic-article", name: "Renamed" }, scope: "full-page" },
      }),
    ).toBe(false);
    expect(
      isNormalizedDocument({
        ...base,
        capture: { adapter: { id: "generic-article", name: "Generic Article" }, scope: "banana" },
      }),
    ).toBe(false);
    expect(
      isNormalizedDocument({
        ...base,
        capture: { adapter: { id: "generic-article", name: "Generic Article" }, scope: "full-page", extra: 1 },
      }),
    ).toBe(false);
  });

  it("round-trips a pull-request document through validation", () => {
    const document: NormalizedDocument = {
      schemaVersion: 1,
      source: {
        kind: "github_pull_request",
        url: "https://github.com/o/r/pull/7",
        owner: "o",
        repo: "r",
        prNumber: 7,
        state: "open",
        baseBranch: "main",
        headBranch: "fix/thing",
      },
      metadata: { title: "Fix the thing", capturedAt: "2026-01-02T00:00:00.000Z" },
      blocks: [
        { type: "heading", level: 2, text: "Summary" },
        { type: "paragraph", text: "This PR fixes the thing." },
      ],
      assets: [],
      capture: {
        adapter: { id: "github-pull-request", name: "GitHub Pull Request" },
        scope: "full-page",
      },
    };
    expect(isNormalizedDocument(document)).toBe(true);
  });
});
