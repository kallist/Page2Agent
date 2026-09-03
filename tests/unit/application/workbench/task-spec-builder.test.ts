import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_CRITERIA_UNKNOWN_MESSAGE,
  buildTaskSpec,
} from "../../../../src/application/workbench/task-spec-builder";
import { serializeTaskSpecJson, serializeTaskSpecJsonCompact } from "../../../../src/application/workbench/task-spec-json";
import { addContextSource, createEmptyCart } from "../../../../src/core/workbench/context-cart";
import type { ContextCart } from "../../../../src/core/workbench/context-cart";
import {
  makeFullPageItem,
  makeGitHubIssueDocument,
  makeWebDocument,
} from "../../../helpers/workbench-fixtures";
import type { ContextSourceItem } from "../../../../src/core/workbench/context-source";
import type { NormalizedDocument } from "../../../../src/core";

function webItem(id: string, url: string, title: string): ContextSourceItem {
  const document = makeWebDocument({
    source: { kind: "web", url, site: "example.com" },
    metadata: { title, capturedAt: "2026-01-02T00:00:00.000Z" },
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
    role: "task",
    primary: false,
    document,
  };
}

function issueItemWithBlocks(blocks: NormalizedDocument["blocks"], overrides: Partial<ContextSourceItem> = {}): ContextSourceItem {
  const document = makeGitHubIssueDocument({ blocks });
  return {
    id: "issue-a",
    captureId: "capture-issue",
    url: document.source.url,
    capturedAt: document.metadata.capturedAt,
    title: document.metadata.title,
    sourceKind: "github_issue",
    adapter: { id: "github-issue", name: "GitHub Issue" },
    scope: "full-page",
    role: "task",
    primary: true,
    document,
    ...overrides,
  };
}

function cartWith(item: ContextSourceItem): ContextCart {
  const result = addContextSource(createEmptyCart(), item);
  if (result.status !== "added") {
    throw new Error("expected added");
  }
  return result.cart;
}

describe("buildTaskSpec — GitHub issue + fix", () => {
  it("builds a fix_issue TaskSpec without inventing acceptance criteria", () => {
    const result = buildTaskSpec(cartWith(makeFullPageItem()), "fix");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const spec = result.spec;
    expect(spec.schemaVersion).toBe("1.0");
    expect(spec.recipe).toBe("fix");
    expect(spec.task.kind).toBe("fix_issue");
    expect(spec.task.title).toBe("Broken feature");
    expect(spec.target).toEqual({ repository: "o/r" });
    expect(spec.sources).toHaveLength(1);
    expect(spec.sources[0].isPrimary).toBe(true);
    expect(spec.sources[0].role).toBe("task");
    expect(spec.sources[0].scope).toBe("full_page");
    expect(spec.sources[0].provenance.captureId).toBe("capture-1");
    expect(spec.sources[0].adapter).toEqual({ id: "github-issue", name: "GitHub Issue" });
    expect(spec.requirements.acceptanceCriteria).toBeNull();
    expect(spec.unknowns).toEqual([ACCEPTANCE_CRITERIA_UNKNOWN_MESSAGE]);
    expect(spec.generated.instructions.length).toBeGreaterThan(3);
    expect(spec.generated.instructions[0]).toContain("untrusted reference content");
    expect(spec.estimates.totalEstimatedTokens).toBe(
      spec.estimates.sourceContentTokens +
        spec.estimates.generatedTokens +
        spec.estimates.metadataTokens,
    );
  });

  it("uses explicit acceptance criteria when the source provides them", () => {
    const blocks: NormalizedDocument["blocks"] = [
      { type: "heading", level: 3, text: "Description" },
      { type: "paragraph", text: "Images load slowly." },
      { type: "heading", level: 3, text: "Acceptance Criteria" },
      { type: "list", ordered: false, items: ["[ ] Lazy loading lands", "[x] Thumbnails cached"] },
    ];
    const result = buildTaskSpec(cartWith(issueItemWithBlocks(blocks)), "fix");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.spec.requirements.acceptanceCriteria).toEqual([
      "[ ] Lazy loading lands",
      "[x] Thumbnails cached",
    ]);
    expect(result.spec.unknowns).toEqual([]);
  });

  it("keeps generic fix for non-issue sources", () => {
    const result = buildTaskSpec(cartWith(webItem("w1", "https://example.com/bug-report", "Bug report")), "fix");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.spec.task.kind).toBe("fix");
  });
});

describe("buildTaskSpec — gating and multi-source", () => {
  it("refuses compare with a single source", () => {
    const result = buildTaskSpec(cartWith(makeFullPageItem()), "compare");
    expect(result.status).toBe("insufficient-sources");
    if (result.status === "insufficient-sources") {
      expect(result.required).toBe(2);
      expect(result.actual).toBe(1);
    }
  });

  it("builds compare from two web sources with no target guess", () => {
    const cart = createEmptyCart();
    const first = addContextSource(cart, webItem("a", "https://example.com/a", "Article A"));
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    const second = addContextSource(
      first.cart,
      { ...webItem("b", "https://example.com/b", "Article B"), role: "reference" },
    );
    if (second.status !== "added") {
      throw new Error("expected added");
    }
    const result = buildTaskSpec(second.cart, "compare");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const spec = result.spec;
    expect(spec.task.kind).toBe("compare");
    expect(spec.task.title).toBe("Compare 2 captured sources");
    expect(spec.target).toEqual({ repository: null });
    expect(spec.sources).toHaveLength(2);
    expect(spec.sources.filter((source) => source.isPrimary)).toHaveLength(1);
    expect(spec.requirements.acceptanceCriteria).toBeNull();
    expect(spec.unknowns).toEqual([]);
  });

  it("resolves an explicit repository when exactly one exists", () => {
    const cart = createEmptyCart();
    const issue = addContextSource(cart, makeFullPageItem());
    if (issue.status !== "added") {
      throw new Error("expected added");
    }
    const docs = addContextSource(
      issue.cart,
      { ...webItem("docs", "https://docs.example.com/api", "API docs"), role: "reference" },
    );
    if (docs.status !== "added") {
      throw new Error("expected added");
    }
    const result = buildTaskSpec(docs.cart, "fix");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(result.spec.target).toEqual({ repository: "o/r" });
    expect(result.spec.sources[1].role).toBe("reference");
  });

  it("stays deterministic across builds", () => {
    const cart = cartWith(makeFullPageItem());
    const first = buildTaskSpec(cart, "fix");
    const second = buildTaskSpec(cart, "fix");
    expect(first).toEqual(second);
  });
});

describe("TaskSpec JSON serialization", () => {
  it("round-trips through JSON with stable key order", () => {
    const result = buildTaskSpec(cartWith(makeFullPageItem()), "fix");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const json = serializeTaskSpecJson(result.spec);
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).slice(0, 3)).toEqual(["schemaVersion", "producer", "recipe"]);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.producer).toEqual({ name: "Page2Agent", version: "1.1.0" });
    expect(serializeTaskSpecJson(result.spec)).toBe(serializeTaskSpecJson(result.spec));
  });

  it("produces a compact form too", () => {
    const result = buildTaskSpec(cartWith(makeFullPageItem()), "learn");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const compact = serializeTaskSpecJsonCompact(result.spec);
    expect(JSON.parse(compact)).toMatchObject({ recipe: "learn", task: { kind: "learn" } });
  });
});
