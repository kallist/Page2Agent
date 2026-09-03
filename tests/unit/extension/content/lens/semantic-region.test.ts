// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveRegionUnder } from "../../../../../src/extension/content/lens/semantic-region";

function makePage(bodyHtml: string): Document {
  document.body.innerHTML = bodyHtml;
  return document;
}

const PAGE_HTML = `
<main class="article">
  <h1>Title</h1>
  <h2 id="h-repro">Reproduction</h2>
  <p id="p1">First step description with a <a href="/x">reference</a>.</p>
  <p id="p2">Second paragraph of reproduction.</p>
  <pre id="code"><code>const x = 1;</code></pre>
  <h2 id="h-exp">Expected Behavior</h2>
  <p id="p3">It should work.</p>
  <table id="table"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
  <ul id="list"><li>one</li><li>two</li></ul>
  <blockquote id="quote">Quoted text.</blockquote>
  <figure id="figure"><img id="img" src="/a.png" alt="diagram"></figure>
</main>
`;

describe("resolveRegionUnder — atomic semantic blocks", () => {
  it("picks the whole code block when hovering inside it", () => {
    const doc = makePage(PAGE_HTML);
    const region = resolveRegionUnder(doc.getElementById("code")!);
    expect(region?.kind).toBe("code");
    expect(region?.elements.map((el) => el.id)).toEqual(["code"]);
    expect(region?.label).toBe("Code");
    expect(region?.estimatedTokens).toBeGreaterThan(0);
  });

  it("picks whole tables, lists and quotes from anywhere inside", () => {
    const doc = makePage(PAGE_HTML);
    expect(resolveRegionUnder(doc.querySelector("td")!)?.elements.map((el) => el.id)).toEqual([
      "table",
    ]);
    expect(resolveRegionUnder(doc.querySelectorAll("li")[1])?.kind).toBe("list");
    expect(resolveRegionUnder(doc.getElementById("quote")!)?.kind).toBe("quote");
  });

  it("selects the image itself", () => {
    const doc = makePage(PAGE_HTML);
    const region = resolveRegionUnder(doc.getElementById("img")!);
    expect(region?.elements.map((el) => el.tagName.toLowerCase())).toEqual(["img"]);
    expect(region?.kind).toBe("image");
  });
});

describe("resolveRegionUnder — heading-anchored runs", () => {
  it("selects the section content between two headings (never crossing)", () => {
    const doc = makePage(PAGE_HTML);
    const region = resolveRegionUnder(doc.getElementById("p2")!);
    expect(region?.elements.map((el) => el.id)).toEqual(["p1", "p2", "code"]);
    expect(region?.heading).toBe("Reproduction");
    expect(region?.kind).toBe("section");
  });

  it("hovering a heading includes the heading plus its section content", () => {
    const doc = makePage(PAGE_HTML);
    const region = resolveRegionUnder(doc.getElementById("h-exp")!);
    expect(region?.elements.map((el) => el.id)).toEqual([
      "h-exp",
      "p3",
      "table",
      "list",
      "quote",
      "figure",
    ]);
  });

  it("labels content with the nearest preceding heading", () => {
    const doc = makePage(`
      <main>
        <h2 id="auth">Authentication</h2>
        <p id="a1">Auth body text.</p>
        <h3 id="tokens">Tokens</h3>
        <p id="a2">Token detail.</p>
      </main>
    `);
    const region = resolveRegionUnder(doc.getElementById("a2")!);
    expect(region?.heading).toBe("Tokens");
    expect(region?.elements.map((el) => el.id)).toEqual(["a2"]);
  });

  it("returns null over chrome-only regions and empty nodes", () => {
    const doc = makePage(`<main><nav id="nav"><a href="/">Home</a></nav></main>`);
    expect(resolveRegionUnder(doc.getElementById("nav")!)).toBeNull();
    const empty = doc.createElement("div");
    doc.body.appendChild(empty);
    expect(resolveRegionUnder(empty)).toBeNull();
  });
});

describe("resolveRegionUnder — safety", () => {
  it("is deterministic for the same element", () => {
    const doc = makePage(PAGE_HTML);
    const first = resolveRegionUnder(doc.getElementById("p2")!);
    const second = resolveRegionUnder(doc.getElementById("p2")!);
    expect(first?.estimatedTokens).toBe(second?.estimatedTokens);
    expect(first?.elements.map((el) => el.id)).toEqual(second?.elements.map((el) => el.id));
  });

  it("never mutates the page while resolving", () => {
    const doc = makePage(PAGE_HTML);
    const before = doc.body.innerHTML;
    resolveRegionUnder(doc.getElementById("p2")!);
    resolveRegionUnder(doc.querySelector("td")!);
    expect(doc.body.innerHTML).toBe(before);
  });
});
