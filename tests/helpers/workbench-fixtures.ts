/**
 * Shared workbench test fixtures — small, valid domain objects.
 * Importing this file never registers tests (pure factory module).
 */
import type { NormalizedDocument } from "../../src/core";
import type { ContextSourceItem } from "../../src/core/workbench/context-source";

export function makeWebDocument(overrides: Partial<NormalizedDocument> = {}): NormalizedDocument {
  const document: NormalizedDocument = {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article", site: "example.com" },
    metadata: {
      title: "Example Article",
      capturedAt: "2026-01-02T00:00:00.000Z",
    },
    blocks: [
      { type: "heading", level: 2, text: "Intro" },
      { type: "paragraph", text: "Some article body text." },
    ],
    assets: [],
    capture: {
      adapter: { id: "generic-article", name: "Generic Article" },
      scope: "full-page",
    },
    ...overrides,
  };
  return document;
}

export function makeGitHubIssueDocument(
  overrides: Partial<NormalizedDocument> = {},
): NormalizedDocument {
  const document: NormalizedDocument = {
    schemaVersion: 1,
    source: {
      kind: "github_issue",
      url: "https://github.com/o/r/issues/12",
      owner: "o",
      repo: "r",
      issueNumber: 12,
    },
    metadata: {
      title: "Broken feature",
      author: "alice",
      publishedAt: "2026-01-01T00:00:00.000Z",
      capturedAt: "2026-01-02T00:00:00.000Z",
    },
    blocks: [
      { type: "heading", level: 2, text: "Description" },
      { type: "paragraph", text: "The feature is broken." },
    ],
    assets: [],
    capture: {
      adapter: { id: "github-issue", name: "GitHub Issue" },
      scope: "full-page",
    },
    ...overrides,
  };
  return document;
}

export function makeFullPageItem(
  overrides: Partial<ContextSourceItem> = {},
): ContextSourceItem {
  const document = makeGitHubIssueDocument();
  const item: ContextSourceItem = {
    id: "item-1",
    captureId: "capture-1",
    url: document.source.url,
    capturedAt: document.metadata.capturedAt,
    title: document.metadata.title,
    sourceKind: document.source.kind,
    adapter: { id: "github-issue", name: "GitHub Issue" },
    scope: "full-page",
    role: "task",
    primary: true,
    document,
    ...overrides,
  };
  return item;
}

export function makeSelectionItem(
  overrides: Partial<ContextSourceItem> = {},
): ContextSourceItem {
  const document = makeWebDocument({
    capture: { adapter: { id: "generic-article", name: "Generic Article" }, scope: "selection" },
  });
  const item: ContextSourceItem = {
    id: "item-selection",
    captureId: "capture-2",
    url: "https://example.com/article",
    capturedAt: document.metadata.capturedAt,
    title: "Architecture section",
    sourceKind: "web",
    adapter: { id: "generic-article", name: "Generic Article" },
    scope: "selection",
    selection: { regions: 1, labels: ["Architecture"] },
    role: "reference",
    primary: false,
    document,
    ...overrides,
  };
  return item;
}
