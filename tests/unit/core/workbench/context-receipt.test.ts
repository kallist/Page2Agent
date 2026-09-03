import { describe, expect, it } from "vitest";
import {
  buildContextNutritionFacts,
  buildContextReceipt,
} from "../../../../src/core/workbench/context-receipt";
import type { ReceiptSourceInput } from "../../../../src/core/workbench/context-receipt";
import {
  makeFullPageItem,
  makeGitHubIssueDocument,
  makeWebDocument,
  makeSelectionItem,
} from "../../../helpers/workbench-fixtures";
import { buildTaskSpec } from "../../../../src/application/workbench/task-spec-builder";
import { addContextSource, createEmptyCart } from "../../../../src/core/workbench/context-cart";
import type { ContextSourceItem } from "../../../../src/core/workbench/context-source";

function receiptSourceOf(item: ContextSourceItem): ReceiptSourceInput {
  return {
    id: item.id,
    title: item.title,
    adapter: item.adapter,
    scope: item.scope,
    selectedLabels: item.selection?.labels ?? [],
    document: item.document,
  };
}

describe("buildContextReceipt", () => {
  it("reports observable included sections for a GitHub issue", () => {
    const document = makeGitHubIssueDocument({
      blocks: [
        { type: "heading", level: 2, text: "Description" },
        { type: "paragraph", text: "The feature is broken." },
        { type: "heading", level: 3, text: "Reproduction" },
        { type: "list", ordered: false, items: ["Step one", "Step two"] },
        { type: "heading", level: 3, text: "Expected Behavior" },
        { type: "paragraph", text: "It should work." },
      ],
    });
    const item = makeFullPageItem({ document });
    const receipt = buildContextReceipt({
      sources: [receiptSourceOf(item)],
      recipe: "fix",
      task: { kind: "fix_issue" },
    });
    const row = receipt.sources[0];
    expect(row.included).toEqual(
      expect.arrayContaining(["Issue Title", "Issue Body", "Author", "Reproduction", "Expected Behavior"]),
    );
    expect(row.excluded).toEqual(
      expect.arrayContaining(["Comments and comment threads", "Navigation", "GitHub UI (sidebars, headers, profile chrome)"]),
    );
    expect(receipt.generated).toEqual(
      expect.arrayContaining(["Recipe: fix", "Task kind: fix_issue", "Agent instructions"]),
    );
    expect(receipt.tokenEstimate.method).toBe("page2agent-heuristic-v1");
    expect(receipt.tokenEstimate.tokens).toBeGreaterThan(0);
  });

  it("reports selected section labels for lens picks", () => {
    const item = makeSelectionItem({
      selection: { regions: 2, labels: ["Authentication", "Error Handling"] },
    });
    const receipt = buildContextReceipt({ sources: [receiptSourceOf(item)] });
    expect(receipt.sources[0].included).toEqual(
      expect.arrayContaining(["Page Title", "Page Content", "Selected Sections", "Authentication", "Error Handling"]),
    );
  });

  it("carries generated task facts and unknowns into the receipt", () => {
    const receipt = buildContextReceipt({
      sources: [receiptSourceOf(makeFullPageItem())],
      recipe: "fix",
      task: { kind: "fix_issue" },
      unknowns: ["Explicit acceptance criteria not provided in the source."],
      warnings: [],
    });
    expect(receipt.generated).toEqual(
      expect.arrayContaining(["Recipe: fix", "Task kind: fix_issue", "Agent instructions"]),
    );
    expect(receipt.unknowns).toHaveLength(1);
    expect(receipt.warnings).toEqual([]);
  });

  it("aggregates tokens across multiple sources", () => {
    const single = buildContextReceipt({ sources: [receiptSourceOf(makeFullPageItem())] });
    const multi = buildContextReceipt({
      sources: [receiptSourceOf(makeFullPageItem()), receiptSourceOf(makeSelectionItem())],
    });
    expect(multi.tokenEstimate.tokens).toBeGreaterThan(single.tokenEstimate.tokens);
  });
});

describe("buildContextNutritionFacts", () => {
  it("computes deterministic shares that sum to ~100", () => {
    const result = buildTaskSpec(
      (() => {
        const added = addContextSource(createEmptyCart(), makeFullPageItem());
        if (added.status !== "added") {
          throw new Error("expected added");
        }
        return added.cart;
      })(),
      "fix",
    );
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const facts = buildContextNutritionFacts({
      spec: result.spec,
      unknowns: result.spec.unknowns,
      warnings: [],
    });
    expect(facts.estimatedTokens).toBeGreaterThan(0);
    expect(facts.sourceContentPercent).toBeGreaterThan(0);
    const totalPercent =
      facts.sourceContentPercent + facts.generatedPercent + facts.metadataPercent;
    expect(totalPercent).toBeGreaterThanOrEqual(99);
    expect(totalPercent).toBeLessThanOrEqual(101);
    expect(facts.counts.sources).toBe(1);
    expect(facts.explicitAcceptanceCriteria).toBe(false);
    expect(facts.provenanceComplete).toBe(true);
    expect(facts.status).toBe("has-unknowns");
  });

  it("marks a clean build when nothing is missing", () => {
    const webDocument = makeWebDocument({
      source: { kind: "web", url: "https://docs.example.com/guide", site: "docs.example.com" },
      metadata: { title: "Guide", capturedAt: "2026-01-02T00:00:00.000Z" },
      capture: { adapter: { id: "technical-docs", name: "Technical Documentation" }, scope: "full-page" },
    });
    const item: ContextSourceItem = {
      id: "docs",
      captureId: "capture-docs",
      url: webDocument.source.url,
      capturedAt: webDocument.metadata.capturedAt,
      title: "Guide",
      sourceKind: "web",
      adapter: { id: "technical-docs", name: "Technical Documentation" },
      scope: "full-page",
      role: "task",
      primary: true,
      document: webDocument,
    };
    const added = addContextSource(createEmptyCart(), item);
    if (added.status !== "added") {
      throw new Error("expected added");
    }
    const result = buildTaskSpec(added.cart, "build");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const facts = buildContextNutritionFacts({ spec: result.spec, unknowns: [], warnings: [] });
    expect(facts.status).toBe("clean");
    expect(facts.explicitAcceptanceCriteria).toBeNull(); // AC is a fix-only concept
  });
});
