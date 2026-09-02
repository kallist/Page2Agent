import { describe, expect, it } from "vitest";
import {
  escapeMarkdownTableCell,
  escapeMarkdownText,
  escapeMarkdownTitle,
  escapeMarkdownUrl,
} from "../../../../src/core/serialize";

describe("escapeMarkdownText", () => {
  it("escapes backslashes, asterisks, underscores, backticks and brackets", () => {
    expect(escapeMarkdownText("a\\b")).toBe("a\\\\b");
    expect(escapeMarkdownText("*bold*")).toBe("\\*bold\\*");
    expect(escapeMarkdownText("_under_")).toBe("\\_under\\_");
    expect(escapeMarkdownText("`code`")).toBe("\\`code\\`");
    expect(escapeMarkdownText("[docs]")).toBe("\\[docs\\]");
  });

  it("never breaks Windows paths", () => {
    expect(escapeMarkdownText("C:\\Users\\Alice\\Page2Agent")).toBe(
      "C:\\\\Users\\\\Alice\\\\Page2Agent",
    );
  });

  it("preserves Unicode completely", () => {
    expect(escapeMarkdownText("中文内容 🐳 café naïve")).toBe("中文内容 🐳 café naïve");
  });

  it("does not over-escape ordinary text", () => {
    expect(escapeMarkdownText("Hello, world! Page2Agent v0.1")).toBe(
      "Hello, world! Page2Agent v0.1",
    );
  });

  it("protects block-level prefixes at line starts", () => {
    expect(escapeMarkdownText("# Heading")).toBe("\\# Heading");
    expect(escapeMarkdownText("## Sub")).toBe("\\## Sub");
    expect(escapeMarkdownText("> quoted")).toBe("\\> quoted");
    expect(escapeMarkdownText("- item")).toBe("\\- item");
    expect(escapeMarkdownText("+ item")).toBe("\\+ item");
    expect(escapeMarkdownText("* item")).toBe("\\* item");
    expect(escapeMarkdownText("1. first")).toBe("1\\. first");
  });

  it("leaves mid-line markers untouched", () => {
    expect(escapeMarkdownText("a - b # c")).toBe("a - b # c");
    expect(escapeMarkdownText("value [1] x")).toBe("value \\[1\\] x");
  });
});

describe("escapeMarkdownUrl", () => {
  it("escapes parentheses but preserves the URL", () => {
    expect(escapeMarkdownUrl("https://example.com/a(b)?q=1#frag")).toBe(
      "https://example.com/a\\(b\\)?q=1#frag",
    );
    expect(escapeMarkdownUrl("https://example.com/plain")).toBe("https://example.com/plain");
  });
});

describe("escapeMarkdownTitle", () => {
  it("escapes quotes and backslashes", () => {
    expect(escapeMarkdownTitle('say "hi"')).toBe('say \\"hi\\"');
  });
});

describe("escapeMarkdownTableCell", () => {
  it("escapes pipes and converts newlines to <br>", () => {
    expect(escapeMarkdownTableCell("A | B")).toBe("A \\| B");
    expect(escapeMarkdownTableCell("line1\nline2")).toBe("line1<br>line2");
  });
});
