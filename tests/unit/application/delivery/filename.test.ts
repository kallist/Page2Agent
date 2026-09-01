import { describe, expect, it } from "vitest";
import { buildMarkdownFilename, sanitizeBaseName } from "../../../../src/application/delivery";
import type { NormalizedDocument } from "../../../../src/core";

function makeWebDocument(title: string): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: { title, capturedAt: "2026-08-31T00:00:00.000Z" },
    blocks: [{ type: "paragraph", text: "Body." }],
    assets: [],
  };
}

describe("sanitizeBaseName", () => {
  it("normalizes whitespace and separators", () => {
    expect(sanitizeBaseName("  Understanding   Context  Bridges  ")).toBe(
      "understanding-context-bridges",
    );
    expect(sanitizeBaseName("a---b--c")).toBe("a-b-c");
  });

  it("replaces invalid filesystem characters", () => {
    expect(sanitizeBaseName('a<b>c:d"e/f\\g|h?i*j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("strips trailing dots and spaces", () => {
    expect(sanitizeBaseName("title.")).toBe("title");
    expect(sanitizeBaseName("title...  ")).toBe("title");
  });

  it("handles control characters", () => {
    expect(sanitizeBaseName("bad\u0000name\u001f")).toBe("bad-name");
  });

  it("preserves Unicode and emoji", () => {
    expect(sanitizeBaseName("中文文章 🐳")).toBe("中文文章-🐳");
  });

  it("bounds length", () => {
    expect(sanitizeBaseName("a".repeat(500)).length).toBe(120);
  });

  it("returns an empty string when nothing meaningful remains", () => {
    expect(sanitizeBaseName("   ")).toBe("");
    expect(sanitizeBaseName("///")).toBe("");
  });

  it("prefixes reserved Windows device names", () => {
    expect(sanitizeBaseName("CON")).toBe("page2agent-con");
    expect(sanitizeBaseName("con")).toBe("page2agent-con");
    expect(sanitizeBaseName("PRN")).toBe("page2agent-prn");
    expect(sanitizeBaseName("AUX")).toBe("page2agent-aux");
    expect(sanitizeBaseName("NUL")).toBe("page2agent-nul");
    expect(sanitizeBaseName("COM1")).toBe("page2agent-com1");
    expect(sanitizeBaseName("LPT9")).toBe("page2agent-lpt9");
    expect(sanitizeBaseName("console")).toBe("console"); // not reserved
  });
});

describe("buildMarkdownFilename", () => {
  it("derives a generic filename from the title", () => {
    expect(buildMarkdownFilename(makeWebDocument("Understanding Context Bridges"))).toBe(
      "understanding-context-bridges.md",
    );
  });

  it("falls back for empty titles", () => {
    expect(buildMarkdownFilename(makeWebDocument("   "))).toBe("page2agent.md");
    expect(buildMarkdownFilename(makeWebDocument("<>:"))).toBe("page2agent.md");
  });

  it("keeps the .md extension exactly once", () => {
    const filename = buildMarkdownFilename(makeWebDocument("already.md"));
    expect(filename).toBe("already-md.md");
  });

  it("derives the deterministic GitHub filename from source identity", () => {
    const document: NormalizedDocument = {
      schemaVersion: 1,
      source: {
        kind: "github_issue",
        url: "https://github.com/acme/page2agent-demo/issues/123",
        owner: "acme",
        repo: "page2agent-demo",
        issueNumber: 123,
      },
      metadata: { title: "Fix: some / issue", capturedAt: "2026-08-31T00:00:00.000Z" },
      blocks: [{ type: "paragraph", text: "Body." }],
      assets: [],
    };
    expect(buildMarkdownFilename(document)).toBe("acme-page2agent-demo-issue-123.md");
  });
});
