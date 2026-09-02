import { describe, expect, it } from "vitest";
import { buildAgentPackage, serializeAgentPackage } from "../../../../src/application";
import type { NormalizedDocument } from "../../../../src/core";
import { extractMarkdownSection } from "../../../helpers/markdown-sections";

function makeWebDocument(): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article", canonicalUrl: "https://example.com/article?p=1" },
    metadata: {
      title: "Understanding Context Bridges",
      author: "Ada",
      publishedAt: "2026-08-01T00:00:00.000Z",
      capturedAt: "2026-08-31T00:00:00.000Z",
    },
    blocks: [{ type: "paragraph", text: "Context bridges connect pages to agents." }],
    assets: [],
  };
}

function makeGitHubDocument(blocks: NormalizedDocument["blocks"]): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: {
      kind: "github_issue",
      url: "https://github.com/acme/page2agent-demo/issues/42",
      owner: "acme",
      repo: "page2agent-demo",
      issueNumber: 42,
      labels: ["bug", "extension"],
    },
    metadata: { title: "Fix deletion crash", capturedAt: "2026-08-31T00:00:00.000Z" },
    blocks,
    assets: [],
  };
}

describe("serializeAgentPackage — generic", () => {
  it("emits the fixed section order without a Source AC section", () => {
    const output = serializeAgentPackage(buildAgentPackage(makeWebDocument()));

    expect(output.startsWith("# Page2Agent Context")).toBe(true);
    const order = [
      "# Page2Agent Context",
      "## Page2Agent Agent Instructions",
      "## Source",
      "## Title",
      "## Content",
    ].map((heading) => output.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(output).toContain("Type: Web Page");
    expect(output).toContain("URL: https://example.com/article");
    expect(output).toContain("Canonical URL: https://example.com/article?p=1");
    expect(output).toContain("Author: Ada");
    expect(output).toContain("Published At: 2026-08-01T00:00:00.000Z");
    expect(output).toContain("Captured At: 2026-08-31T00:00:00.000Z");
    expect(output).toContain("## Title\n\nUnderstanding Context Bridges");
    expect(output).toContain("Context bridges connect pages to agents.");
    expect(output).not.toContain("## Source Acceptance Criteria");
    expect(output).not.toContain("Audit the target repository");
    expect(output).not.toContain("Summarize");
  });

  it("places generated instructions before source content", () => {
    const output = serializeAgentPackage(buildAgentPackage(makeWebDocument()));
    expect(output.indexOf("## Page2Agent Agent Instructions")).toBeLessThan(
      output.indexOf("## Source"),
    );
  });
});

describe("serializeAgentPackage — github with AC", () => {
  it("emits source facts, issue title/body and explicit Source Acceptance Criteria", () => {
    const document = makeGitHubDocument([
      { type: "paragraph", text: "The extension crashes." },
      { type: "heading", level: 2, text: "Acceptance Criteria" },
      { type: "list", ordered: false, items: ["[x] Latest capture wins", "[ ] Existing content is preserved"] },
    ]);
    const output = serializeAgentPackage(buildAgentPackage(document));

    expect(output).toContain("Type: GitHub Issue");
    expect(output).toContain("Repository: acme/page2agent-demo");
    expect(output).toContain("Issue: #42");
    expect(output).toContain("Labels: bug, extension");
    expect(output).toContain("## Issue Title\n\nFix deletion crash");
    expect(output).toContain("## Issue Body");
    expect(output).toContain("The extension crashes.");

    const criteria = extractMarkdownSection(output, "Source Acceptance Criteria");
    expect(criteria).toBe("- [x] Latest capture wins\n- [ ] Existing content is preserved");
    expect(criteria).not.toContain("Audit the target repository");
    expect(criteria).not.toContain("regression coverage");
    expect(criteria).not.toContain("Review the final diff");
  });
});

describe("serializeAgentPackage — github without AC", () => {
  it("emits the exact truthful sentinel", () => {
    const document = makeGitHubDocument([
      { type: "paragraph", text: "App crashes after repeated capture." },
    ]);
    const output = serializeAgentPackage(buildAgentPackage(document));
    const criteria = extractMarkdownSection(output, "Source Acceptance Criteria");
    expect(criteria).toBe("Not explicitly provided in source.");
    expect(output).toContain("## Source Acceptance Criteria\n\nNot explicitly provided in source.");
  });
});

describe("serializeAgentPackage — generated instructions", () => {
  it("always contains a clear untrusted-source trust boundary", () => {
    const genericOutput = serializeAgentPackage(buildAgentPackage(makeWebDocument()));
    const githubOutput = serializeAgentPackage(
      buildAgentPackage(makeGitHubDocument([{ type: "paragraph", text: "x" }])),
    );
    expect(genericOutput).toContain("untrusted");
    expect(githubOutput).toContain("untrusted");
  });

  it("never mentions a provider, platform role, or harness", () => {
    const githubOutput = serializeAgentPackage(
      buildAgentPackage(makeGitHubDocument([{ type: "paragraph", text: "x" }])),
    );
    expect(githubOutput).not.toContain("Codex");
    expect(githubOutput).not.toContain("Claude");
    expect(githubOutput).not.toContain("DeepSeek");
    expect(githubOutput).not.toContain("SYSTEM:");
    expect(githubOutput).not.toContain("DEVELOPER:");
  });
});

describe("serializeAgentPackage — format invariants", () => {
  it("ends with exactly one trailing newline and is deterministic", () => {
    const document = makeGitHubDocument([
      { type: "paragraph", text: "x" },
      { type: "code", code: "const a = 1;" },
    ]);
    const first = serializeAgentPackage(buildAgentPackage(document));
    const second = serializeAgentPackage(buildAgentPackage(document));
    const third = serializeAgentPackage(buildAgentPackage(document));
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});
