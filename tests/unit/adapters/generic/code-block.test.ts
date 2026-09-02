// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  detectLanguageHint,
  extractCodeBlock,
  tidyCodeWhitespace,
} from "../../../../src/shared/dom/code-block";
import { loadHtml } from "../../../helpers/load-html-fixture";

function preFrom(html: string): Element {
  const document = loadHtml(`<!doctype html><html><body>${html}</body></html>`);
  const pre = document.querySelector("pre");
  if (pre === null) {
    throw new Error("test fixture must contain a <pre> element");
  }
  return pre;
}

function codePre(html: string): { pre: Element; code: Element | null } {
  const pre = preFrom(html);
  return { pre, code: pre.querySelector("code") };
}

describe("detectLanguageHint", () => {
  it("detects common language class patterns", () => {
    const python = codePre('<pre><code class="language-python">x</code></pre>');
    expect(detectLanguageHint(python.code, python.pre)).toBe("python");

    const cpp = codePre('<pre class="language-cpp"><code>x</code></pre>');
    expect(detectLanguageHint(cpp.code, cpp.pre)).toBe("cpp");

    const js = codePre('<pre><code class="lang-js">x</code></pre>');
    expect(detectLanguageHint(js.code, js.pre)).toBe("js");

    const highlight = codePre('<pre><code class="highlight-source-python">x</code></pre>');
    expect(detectLanguageHint(highlight.code, highlight.pre)).toBe("python");
  });

  it("normalizes the hint (lowercase, trimmed)", () => {
    const ts = codePre('<pre><code class="language-TS">x</code></pre>');
    expect(detectLanguageHint(ts.code, ts.pre)).toBe("ts");
  });

  it("returns undefined when no hint exists", () => {
    const plain = codePre("<pre><code>x</code></pre>");
    expect(detectLanguageHint(plain.code, plain.pre)).toBeUndefined();

    const empty = codePre('<pre><code class="language-">x</code></pre>');
    expect(detectLanguageHint(empty.code, empty.pre)).toBeUndefined();

    const lineNumbers = codePre('<pre class="line-numbers"><code>x</code></pre>');
    expect(detectLanguageHint(lineNumbers.code, lineNumbers.pre)).toBeUndefined();
  });
});

describe("extractCodeBlock", () => {
  it("preserves indentation and code exactly", () => {
    const block = extractCodeBlock(
      preFrom('<pre><code class="language-python">def greet(name):\n    message = f"hello, {name}"\n    return message</code></pre>'),
    );
    expect(block).toEqual({
      type: "code",
      code: 'def greet(name):\n    message = f"hello, {name}"\n    return message',
      language: "python",
    });
  });

  it("decodes HTML entities through DOM semantics", () => {
    const block = extractCodeBlock(preFrom("<pre>if (a &lt; b &amp;&amp; b &gt; 0) {}</pre>"));
    expect(block?.code).toBe("if (a < b && b > 0) {}");
  });

  it("preserves backticks verbatim", () => {
    const block = extractCodeBlock(
      preFrom("<pre>console.log(`tick ${a} — backtick: `x``);</pre>"),
    );
    expect(block?.code).toBe("console.log(`tick ${a} — backtick: `x``);");
  });

  it("removes copy buttons inside the code subtree", () => {
    const block = extractCodeBlock(
      preFrom("<pre><code><button>Copy</button>code here</code></pre>"),
    );
    expect(block?.code).toBe("code here");
  });

  it("removes line-number gutters and copy buttons from plain pre content", () => {
    const block = extractCodeBlock(
      preFrom(
        '<pre><button class="copy-button">Copy</button>\n<span class="line-numbers">1\n2</span>actual code line one\nactual code line two</pre>',
      ),
    );
    expect(block?.code).toBe("actual code line one\nactual code line two");
  });

  it("removes aria-hidden decorative nodes", () => {
    const block = extractCodeBlock(preFrom('<pre><span aria-hidden="true">deco</span>code</pre>'));
    expect(block?.code).toBe("code");
  });

  it("strips exactly one formatting newline at each end", () => {
    const block = extractCodeBlock(
      preFrom("<pre><code>\ndef x():\n    pass\n</code></pre>"),
    );
    expect(block?.code).toBe("def x():\n    pass");
  });

  it("returns null for empty code", () => {
    expect(extractCodeBlock(preFrom("<pre><code>   </code></pre>"))).toBeNull();
    expect(extractCodeBlock(preFrom("<pre></pre>"))).toBeNull();
  });
});

describe("tidyCodeWhitespace", () => {
  it("only removes a single leading/trailing newline", () => {
    expect(tidyCodeWhitespace("\ncode\n")).toBe("code");
    expect(tidyCodeWhitespace("code\n")).toBe("code");
    expect(tidyCodeWhitespace("\n\ncode\n\n")).toBe("\ncode\n");
    expect(tidyCodeWhitespace("  indented  ")).toBe("  indented  ");
  });
});
