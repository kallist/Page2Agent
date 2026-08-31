// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { domToBlocks } from "../../../../src/shared/dom/blocks";
import { getNormalizedText } from "../../../../src/shared/dom/text";
import type { ContentBlock } from "../../../../src/core";
import { FIXTURE_BASE_URL, loadHtml } from "../../../helpers/load-html-fixture";

function blocksFrom(bodyHtml: string): ContentBlock[] {
  const document = loadHtml(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  return domToBlocks(document.body, FIXTURE_BASE_URL);
}

function texts(blocks: ContentBlock[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "quote":
        return [block.text];
      default:
        return [];
    }
  });
}

describe("domToBlocks containers", () => {
  it("turns div-wrapped paragraphs into separate paragraphs without duplication", () => {
    const blocks = blocksFrom("<div><p>A</p><p>B</p></div>");
    expect(texts(blocks)).toEqual(["A", "B"]);
  });

  it("treats inline-only wrappers as paragraphs with link references", () => {
    const blocks = blocksFrom('<div>Hello <a href="/docs">world</a>!</div>');
    expect(texts(blocks)).toEqual(["Hello world!"]);
    expect(blocks.filter((block) => block.type === "link")).toEqual([
      { type: "link", href: "https://example.com/docs", text: "world" },
    ]);
  });

  it("treats a text-only leaf container as a paragraph", () => {
    expect(texts(blocksFrom("<div>Just text.</div>"))).toEqual(["Just text."]);
  });
});

describe("domToBlocks links", () => {
  it("converts standalone anchors to link blocks", () => {
    expect(blocksFrom('<a href="https://example.com/x">go</a>')).toEqual([
      { type: "link", href: "https://example.com/x", text: "go" },
    ]);
  });

  it("keeps unsafe anchor text but never creates a link block", () => {
    const blocks = blocksFrom('<p>See <a href="javascript:alert(1)">here</a>.</p>');
    expect(texts(blocks)).toEqual(["See here."]);
    expect(blocks.filter((block) => block.type === "link")).toHaveLength(0);
  });

  it("normalizes relative and mailto links", () => {
    const blocks = blocksFrom('<p>Mail <a href="mailto:help@example.com">us</a>.</p>');
    expect(blocks.filter((block) => block.type === "link")).toEqual([
      { type: "link", href: "mailto:help@example.com", text: "us" },
    ]);
  });
});

describe("domToBlocks lists and quotes", () => {
  it("extracts ordered/unordered lists with flat items", () => {
    const blocks = blocksFrom("<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol>");
    expect(blocks).toEqual([
      { type: "list", ordered: false, items: ["a", "b"] },
      { type: "list", ordered: true, items: ["1"] },
    ]);
  });

  it("flattens nested list markup into the parent item (V0.1 flat model)", () => {
    const blocks = blocksFrom("<ul><li>one<ul><li>nested</li></ul></li></ul>");
    expect(blocks).toEqual([{ type: "list", ordered: false, items: ["one nested"] }]);
  });

  it("drops empty list items and empty lists", () => {
    const blocks = blocksFrom("<ul><li>a</li><li>   </li></ul><ol></ol>");
    expect(blocks).toEqual([{ type: "list", ordered: false, items: ["a"] }]);
  });

  it("extracts a text-only blockquote as a quote block", () => {
    expect(texts(blocksFrom("<blockquote><p>Quoted.</p></blockquote>"))).toEqual(["Quoted."]);
  });

  it("recurses blockquotes containing complex children", () => {
    const blocks = blocksFrom("<blockquote><pre>code</pre></blockquote>");
    expect(blocks).toEqual([{ type: "code", code: "code" }]);
  });
});

describe("domToBlocks images", () => {
  it("normalizes relative image URLs", () => {
    const blocks = blocksFrom('<img src="/images/diagram.png" alt="Diagram" title="Fig">');
    expect(blocks).toEqual([
      { type: "image", src: "https://example.com/images/diagram.png", alt: "Diagram", title: "Fig" },
    ]);
  });

  it("falls back to data-src / data-original attributes", () => {
    expect(blocksFrom('<img data-src="/lazy.png">')).toEqual([
      { type: "image", src: "https://example.com/lazy.png" },
    ]);
    expect(blocksFrom('<img data-original="/orig.png">')).toEqual([
      { type: "image", src: "https://example.com/orig.png" },
    ]);
  });

  it("skips unsafe and broken images without failing", () => {
    expect(blocksFrom('<img src="javascript:alert(1)">')).toEqual([]);
    expect(blocksFrom('<img src="data:image/png;base64,AAAA">')).toEqual([]);
    expect(blocksFrom("<img>")).toEqual([]);
  });

  it("keeps figure captions, skipping exact alt duplicates", () => {
    const duplicated = blocksFrom(
      '<figure><img src="/a.png" alt="Same"><figcaption>Same</figcaption></figure>',
    );
    expect(texts(duplicated)).toEqual([]);
    expect(duplicated.filter((block) => block.type === "image")).toHaveLength(1);

    const different = blocksFrom(
      '<figure><img src="/a.png" alt="Alt"><figcaption>Caption text</figcaption></figure>',
    );
    expect(texts(different)).toEqual(["Caption text"]);
  });
});

describe("domToBlocks tables", () => {
  it("extracts headers from an all-th first row", () => {
    const blocks = blocksFrom(
      "<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>",
    );
    expect(blocks).toEqual([
      { type: "table", headers: ["H1", "H2"], rows: [["a", "b"]] },
    ]);
  });

  it("extracts headerless tables", () => {
    const blocks = blocksFrom("<table><tr><td>a</td><td>b</td></tr></table>");
    expect(blocks).toEqual([{ type: "table", rows: [["a", "b"]] }]);
  });

  it("falls back to visible text for ragged tables", () => {
    const blocks = blocksFrom("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>");
    expect(texts(blocks)).toEqual(["a b c"]);
    expect(blocks.filter((block) => block.type === "table")).toHaveLength(0);
  });
});

describe("domToBlocks text semantics", () => {
  it("treats <br> as whitespace", () => {
    expect(texts(blocksFrom("<p>line1<br>line2</p>"))).toEqual(["line1 line2"]);
  });

  it("keeps inline code inside paragraph text (no separate code block)", () => {
    const blocks = blocksFrom("<p>Use <code>npm run build</code> now.</p>");
    expect(texts(blocks)).toEqual(["Use npm run build now."]);
    expect(blocks.filter((block) => block.type === "code")).toHaveLength(0);
  });

  it("never turns scripts or styles into content", () => {
    const blocks = blocksFrom(
      "<div><script>var x = 1;</script><style>p { color: red }</style><p>Real.</p></div>",
    );
    expect(texts(blocks)).toEqual(["Real."]);
  });

  it("normalizes whitespace deterministically", () => {
    expect(getNormalizedText(loadHtml("<p>Hello   world\n\nPage2Agent</p>").querySelector("p")!)).toBe(
      "Hello world Page2Agent",
    );
  });
});
