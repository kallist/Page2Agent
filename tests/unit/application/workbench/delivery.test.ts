import { describe, expect, it } from "vitest";
import {
  buildTaskSpecFilename,
  serializeAgentContext,
  serializeSourcesMarkdown,
} from "../../../../src/application/workbench/delivery";
import { buildTaskSpec } from "../../../../src/application/workbench/task-spec-builder";
import { addContextSource, createEmptyCart } from "../../../../src/core/workbench/context-cart";
import { makeFullPageItem, makeWebDocument } from "../../../helpers/workbench-fixtures";
import type { ContextCart, ContextSourceItem } from "../../../../src/core";

function cartWithOneIssue(): ContextCart {
  const result = addContextSource(createEmptyCart(), makeFullPageItem());
  if (result.status !== "added") {
    throw new Error("expected added");
  }
  return result.cart;
}

function webItem(id: string, url: string, title: string): ContextSourceItem {
  const document = makeWebDocument({
    source: { kind: "web", url, site: "example.com" },
    metadata: { title, capturedAt: "2026-09-01T00:00:00.000Z" },
    blocks: [{ type: "paragraph", text: `${title} content line.` }],
  });
  return {
    id,
    captureId: `capture-${id}`,
    url,
    capturedAt: document.metadata.capturedAt,
    title,
    sourceKind: "web",
    adapter: { id: "generic-article", name: "Generic Article" },
    scope: "full-page",
    role: "reference",
    primary: false,
    document,
  };
}

function specFor(recipe: "learn" | "compare" | "fix", cart: ContextCart) {
  const result = buildTaskSpec(cart, recipe);
  if (result.status !== "ok") {
    throw new Error("expected ok");
  }
  return result.spec;
}

describe("serializeAgentContext", () => {
  it("partitions generated facts from source content for a single issue", () => {
    const agent = serializeAgentContext(specFor("fix", cartWithOneIssue()));
    expect(agent.startsWith("# Page2Agent Task\n")).toBe(true);
    expect(agent).toContain("Recipe: Fix");
    expect(agent).toContain("Task kind: fix_issue");
    expect(agent).toContain("## Task Instructions");
    expect(agent).toContain("untrusted reference content");
    expect(agent).toContain("## Sources");
    expect(agent).toContain("### Source 1 — Broken feature");
    expect(agent).toContain("Role: Task · Primary");
    expect(agent).toContain("Type: GitHub Issue");
    expect(agent).toContain("URL: https://github.com/o/r/issues/12");
    expect(agent).toContain("Capture: Full page");
    expect(agent).toContain("Unknowns:");
    expect(agent).toContain("Explicit acceptance criteria not provided in the source.");
    // Source content sits under its own heading, after the meta block.
    const bodyIndex = agent.indexOf("The feature is broken.");
    expect(bodyIndex).toBeGreaterThan(agent.indexOf("### Source 1"));
  });

  it("marks every source with role, index and scope in compare mode", () => {
    let cart = createEmptyCart();
    const first = addContextSource(cart, { ...webItem("a", "https://example.com/a", "Article A"), role: "task", primary: true });
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    cart = first.cart;
    const second = addContextSource(cart, webItem("b", "https://example.com/b", "Article B"));
    if (second.status !== "added") {
      throw new Error("expected added");
    }
    const agent = serializeAgentContext(specFor("compare", second.cart));
    expect(agent).toContain("### Source 1 — Article A");
    expect(agent).toContain("### Source 2 — Article B");
    expect(agent).toContain("Role: Reference");
    // Every paragraph group stays inside its own source section.
    const aEnd = agent.indexOf("### Source 2 — Article B");
    const aBody = agent.slice(0, aEnd);
    expect(aBody).toContain("Article A content line.");
    expect(aBody).not.toContain("Article B content line.");
    const bBody = agent.slice(aEnd);
    expect(bBody).not.toContain("Article A content line.");
    expect(bBody).toContain("Article B content line.");
  });

  it("keeps byte-determinism across calls", () => {
    const spec = specFor("fix", cartWithOneIssue());
    expect(serializeAgentContext(spec)).toBe(serializeAgentContext(spec));
  });

  it("never lets source text reach the instructions section", () => {
    const spec = specFor("learn", cartWithOneIssue());
    const agent = serializeAgentContext(spec);
    const instructions = agent.slice(0, agent.indexOf("## Sources"));
    expect(instructions).not.toContain("The feature is broken.");
  });
});

describe("serializeSourcesMarkdown", () => {
  it("omits generated instructions and headers", () => {
    const markdown = serializeSourcesMarkdown(specFor("fix", cartWithOneIssue()));
    expect(markdown).not.toContain("Task Instructions");
    expect(markdown).not.toContain("Recipe: Fix");
    expect(markdown).not.toContain("untrusted");
    expect(markdown).toContain("### Source 1 — Broken feature");
    expect(markdown).toContain("The feature is broken.");
  });
});

describe("buildTaskSpecFilename", () => {
  it("produces a deterministic slug-based json filename", () => {
    const spec = specFor("fix", cartWithOneIssue());
    const filename = buildTaskSpecFilename(spec);
    expect(filename.endsWith("-taskspec.json")).toBe(true);
    expect(filename).toContain("broken-feature");
    expect(buildTaskSpecFilename(spec)).toBe(filename);
  });
});
