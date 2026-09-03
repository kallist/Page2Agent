// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { materializeLensRegions } from "../../../../../src/extension/content/lens/lens-materialize";
import { resolveRegionUnder } from "../../../../../src/extension/content/lens/semantic-region";
import { isNormalizedDocument } from "../../../../../src/core";

const GENERIC_URL = "https://example.com/article";
const ISSUE_URL = "https://github.com/acme/page2agent-demo/issues/42";

function makeDoc(bodyHtml: string, url: string): Document {
  return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url,
  }).window.document;
}

function sessionFor(url: string) {
  return { captureId: "capture-lens-1", url, capturedAt: "2026-09-01T00:00:00.000Z" };
}

describe("materializeLensRegions", () => {
  it("returns null when nothing is picked", () => {
    expect(materializeLensRegions({ session: sessionFor(GENERIC_URL), regions: [] })).toBeNull();
  });

  it("builds a validated selection document from generic picks", () => {
    const doc = makeDoc(
      `<main><h2 id="a">Authentication</h2><p>Use bearer tokens.</p><p>Refresh flow.</p>
       <h2 id="s">Streaming</h2><p>SSE chunks arrive here.</p></main>`,
      GENERIC_URL,
    );
    const sectionRegion = resolveRegionUnder(doc.getElementById("s")!)!;
    const result = materializeLensRegions({
      session: sessionFor(GENERIC_URL),
      regions: [sectionRegion],
    });
    expect(result).not.toBeNull();
    const { document: fragment, regions } = result!;
    expect(isNormalizedDocument(fragment)).toBe(true);
    expect(fragment.source.kind).toBe("web");
    expect(fragment.capture).toEqual({
      adapter: { id: "context-lens", name: "Context Lens" },
      scope: "selection",
    });
    expect(fragment.blocks.length).toBeGreaterThan(1);
    expect(regions).toHaveLength(1);
    expect(regions[0].label).toBe("Streaming");
    expect(regions[0].tokens).toBeGreaterThan(0);
    expect(fragment.metadata.title).toBe("Streaming");
    const text = fragment.blocks
      .filter((block) => block.type === "paragraph")
      .map((block) => (block.type === "paragraph" ? block.text : ""))
      .join(" ");
    expect(text).toContain("SSE chunks arrive here.");
    expect(text).not.toContain("bearer");
  });

  it("routes issue-body picks through the GitHub converter (task markers)", () => {
    const html = readFileSync(resolve("fixtures", "github", "issue-task-list.html"), "utf8");
    const doc = new JSDOM(html, { url: ISSUE_URL }).window.document;
    // Pick the paragraph inside the body, then a following list region.
    const bodyParagraph = doc.querySelector(".js-comment-body p")!;
    const paragraphRegion = resolveRegionUnder(bodyParagraph)!;
    const result = materializeLensRegions({
      session: sessionFor(ISSUE_URL),
      regions: [paragraphRegion],
    });
    const fragment = result!.document;
    expect(fragment.capture?.adapter.id).toBe("github-issue");
    expect(fragment.source.kind).toBe("github_issue");
  });

  it("labels every pick region and keeps order", () => {
    const doc = makeDoc(
      `<main><h2 id="x">Section X</h2><p>Alpha text here.</p><h2 id="y">Section Y</h2><p>Beta text.</p></main>`,
      GENERIC_URL,
    );
    const regionY = resolveRegionUnder(doc.getElementById("y")!)!;
    const regionX = resolveRegionUnder(doc.getElementById("x")!)!;
    const result = materializeLensRegions({
      session: sessionFor(GENERIC_URL),
      regions: [regionX, regionY],
    });
    expect(result?.regions.map((region) => region.label)).toEqual(["Section X", "Section Y"]);
    // document title is the first pick's label
    expect(result?.document.metadata.title).toBe("Section X");
  });
});
