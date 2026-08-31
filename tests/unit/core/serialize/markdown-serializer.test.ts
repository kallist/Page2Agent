import { describe, expect, it } from "vitest";
import {
  chooseFenceLength,
  serializeContentBlocks,
  serializeNormalizedDocument,
} from "../../../../src/core/serialize";
import type { ContentBlock, NormalizedDocument } from "../../../../src/core";

function makeDocument(blocks: ContentBlock[]): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: { title: "Article title", capturedAt: "2026-08-31T00:00:00.000Z" },
    blocks,
    assets: [],
  };
}

describe("serializeContentBlocks", () => {
  it("serializes paragraphs and headings with preserved levels", () => {
    expect(serializeContentBlocks([{ type: "paragraph", text: "Hello." }])).toBe("Hello.\n");
    expect(
      serializeContentBlocks([{ type: "heading", level: 3, text: "Security" }]),
    ).toBe("### Security\n");
    expect(
      serializeContentBlocks([
        { type: "paragraph", text: "Intro." },
        { type: "heading", level: 2, text: "Details" },
      ]),
    ).toBe("Intro.\n\n## Details\n");
  });

  it("serializes multi-line quotes with a > prefix on every line", () => {
    expect(
      serializeContentBlocks([{ type: "quote", text: "line 1\nline 2" }]),
    ).toBe("> line 1\n> line 2\n");
  });

  it("serializes unordered and ordered lists", () => {
    expect(
      serializeContentBlocks([{ type: "list", ordered: false, items: ["a", "b"] }]),
    ).toBe("- a\n- b\n");
    expect(
      serializeContentBlocks([{ type: "list", ordered: true, items: ["first", "second"] }]),
    ).toBe("1. first\n2. second\n");
  });

  it("preserves GitHub task-list markers without escaping them", () => {
    expect(
      serializeContentBlocks([
        { type: "list", ordered: false, items: ["[x] done", "[ ] pending"] },
      ]),
    ).toBe("- [x] done\n- [ ] pending\n");
  });

  it("escapes non-marker brackets inside list items", () => {
    expect(
      serializeContentBlocks([{ type: "list", ordered: false, items: ["array[x] value"] }]),
    ).toBe("- array\\[x\\] value\n");
  });

  it("serializes links with escaped text and preserved URLs", () => {
    expect(
      serializeContentBlocks([
        { type: "link", href: "https://example.com/a(b)?q=1", text: "docs [x]" },
      ]),
    ).toBe("[docs \\[x\\]](https://example.com/a\\(b\\)?q=1)\n");
  });

  it("serializes images with alt, title and escaping", () => {
    expect(
      serializeContentBlocks([{ type: "image", src: "https://example.com/a.png", alt: "diagram" }]),
    ).toBe("![diagram](https://example.com/a.png)\n");
    expect(
      serializeContentBlocks([
        { type: "image", src: "https://example.com/a.png", alt: "diagram", title: 'say "hi"' },
      ]),
    ).toBe('![diagram](https://example.com/a.png "say \\"hi\\"")\n');
  });

  it("always ends with exactly one trailing newline", () => {
    const blocks: ContentBlock[] = [
      { type: "paragraph", text: "p" },
      { type: "heading", level: 2, text: "h" },
      { type: "code", code: "x" },
      { type: "list", ordered: true, items: ["1"] },
    ];
    const output = serializeContentBlocks(blocks);
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
  });

  it("is deterministic (byte-for-byte)", () => {
    const blocks: ContentBlock[] = [
      { type: "paragraph", text: "p" },
      { type: "code", code: "const x = 1;" },
    ];
    const first = serializeContentBlocks(blocks);
    const second = serializeContentBlocks(blocks);
    const third = serializeContentBlocks(blocks);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

describe("code fences", () => {
  it("chooses fence length = max(3, longest backtick run + 1)", () => {
    expect(chooseFenceLength("")).toBe(3);
    expect(chooseFenceLength("`")).toBe(3);
    expect(chooseFenceLength("no backticks")).toBe(3);
    expect(chooseFenceLength("```")).toBe(4);
    expect(chooseFenceLength("````")).toBe(5);
    expect(chooseFenceLength("``````")).toBe(7);
    expect(chooseFenceLength("a`b``c```d")).toBe(4);
    expect(chooseFenceLength("```a")).toBe(4);
    expect(chooseFenceLength("a```")).toBe(4);
  });

  it("serializes code with the chosen fence length and language", () => {
    expect(serializeContentBlocks([{ type: "code", code: "const x = 1;" }])).toBe(
      "```\nconst x = 1;\n```\n",
    );
    expect(
      serializeContentBlocks([{ type: "code", code: "print('hi')", language: "python" }]),
    ).toBe("```python\nprint('hi')\n```\n");
  });

  it("handles triple, quadruple and six-backtick source content", () => {
    const triple = serializeContentBlocks([{ type: "code", code: "a\n```\nb" }]);
    expect(triple).toBe("````\na\n```\nb\n````\n");
    expect(triple).toContain("a\n```\nb");

    const four = serializeContentBlocks([{ type: "code", code: "````" }]);
    expect(four.startsWith("`````\n")).toBe(true);

    const six = serializeContentBlocks([{ type: "code", code: "``````" }]);
    expect(six.startsWith("```````\n")).toBe(true);
  });

  it("never mutates or trims the code body", () => {
    const code = 'def f():\n    print("```")\n\n';
    const output = serializeContentBlocks([{ type: "code", code }]);
    expect(output).toContain(code);
  });

  it("ignores unsafe language hints so they cannot break the opening fence", () => {
    expect(
      serializeContentBlocks([{ type: "code", code: "x", language: "py thon" }]),
    ).toBe("```\nx\n```\n");
    expect(
      serializeContentBlocks([{ type: "code", code: "x", language: "ba`ck" }]),
    ).toBe("```\nx\n```\n");
  });
});

describe("tables", () => {
  it("serializes tables with headers", () => {
    expect(
      serializeContentBlocks([
        { type: "table", headers: ["Name", "Value"], rows: [["A", "B"]] },
      ]),
    ).toBe("| Name | Value |\n| --- | --- |\n| A | B |\n");
  });

  it("serializes headerless tables with an empty structural header row", () => {
    expect(serializeContentBlocks([{ type: "table", rows: [["A", "B"]] }])).toBe(
      "|  |  |\n| --- | --- |\n| A | B |\n",
    );
  });

  it("escapes pipes in cells", () => {
    expect(
      serializeContentBlocks([{ type: "table", rows: [["A | B"]] }]),
    ).toBe("|  |\n| --- |\n| A \\| B |\n");
  });

  it("converts newlines in cells to <br>", () => {
    expect(
      serializeContentBlocks([{ type: "table", rows: [["line1\nline2"]] }]),
    ).toBe("|  |\n| --- |\n| line1<br>line2 |\n");
  });

  it("handles single-column and Unicode tables", () => {
    expect(serializeContentBlocks([{ type: "table", headers: ["X"], rows: [["1"]] }])).toBe(
      "| X |\n| --- |\n| 1 |\n",
    );
    expect(serializeContentBlocks([{ type: "table", rows: [["中文"]] }])).toBe(
      "|  |\n| --- |\n| 中文 |\n",
    );
  });
});

describe("serializeNormalizedDocument", () => {
  it("emits title, metadata and body deterministically", () => {
    const document = makeDocument([{ type: "paragraph", text: "Body text." }]);
    const output = serializeNormalizedDocument(document);
    expect(output).toBe(
      "# Article title\n\nSource: https://example.com/article\nCaptured At: 2026-08-31T00:00:00.000Z\n\nBody text.\n",
    );
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
  });

  it("emits optional metadata when present", () => {
    const document = makeDocument([{ type: "paragraph", text: "x" }]);
    document.metadata.author = "Ada";
    document.metadata.publishedAt = "2026-08-01T00:00:00.000Z";
    const output = serializeNormalizedDocument(document);
    expect(output).toContain("Author: Ada");
    expect(output).toContain("Published At: 2026-08-01T00:00:00.000Z");
  });

  it("never contains Page2Agent generated instructions", () => {
    const output = serializeNormalizedDocument(makeDocument([{ type: "paragraph", text: "x" }]));
    expect(output).not.toContain("Page2Agent Agent Instructions");
    expect(output).not.toContain("Audit the target repository");
  });
});
