import { describe, expect, it } from "vitest";
import {
  addCandidateToCart,
  createCandidateContextItem,
  deriveWorkbenchOutputs,
  primarySourceId,
  recipeGateMessage,
  resolveRecipeState,
} from "../../../../../src/extension/sidepanel/workbench/workbench-model";
import { addContextSource, createEmptyCart } from "../../../../../src/core";
import type { ContextCart, ContextSourceItem } from "../../../../../src/core";
import { makeFullPageItem, makeWebDocument, makeGitHubIssueDocument } from "../../../../../tests/helpers/workbench-fixtures";

const ISSUE_DOC = makeGitHubIssueDocument();
const CANDIDATE = createCandidateContextItem(ISSUE_DOC, {
  captureId: "capture-1",
  url: ISSUE_DOC.source.url,
  title: ISSUE_DOC.metadata.title,
  capturedAt: ISSUE_DOC.metadata.capturedAt,
});

describe("createCandidateContextItem", () => {
  it("shapes a capture as a task/primary candidate (first item semantics)", () => {
    expect(CANDIDATE.id).toBe("captured-capture-1");
    expect(CANDIDATE.role).toBe("task");
    expect(CANDIDATE.primary).toBe(true);
    expect(CANDIDATE.adapter).toEqual({ id: "github-issue", name: "GitHub Issue" });
  });

  it("keeps selection metadata when the document is a pick fragment", () => {
    const document = makeWebDocument({
      capture: { adapter: { id: "context-lens", name: "Context Lens" }, scope: "selection" },
    });
    const candidate = createCandidateContextItem(document, {
      captureId: "capture-lens",
      url: "https://example.com/article",
      title: "Authentication",
      capturedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(candidate.scope).toBe("selection");
    expect(candidate.adapter?.id).toBe("context-lens");
  });
});

describe("workbench basis", () => {
  it("uses the cart once it has items", () => {
    const added = addContextSource(createEmptyCart(), makeFullPageItem());
    if (added.status !== "added") {
      throw new Error("expected added");
    }
    const outputs = deriveWorkbenchOutputs({
      cart: added.cart,
      candidate: CANDIDATE,
      selectedRecipe: null,
    });
    expect(outputs.basis.usingCaptureOnly).toBe(false);
    expect(outputs.basis.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(outputs.agentContext).toContain("### Source 1 — Broken feature");
  });

  it("falls back to the capture candidate while the cart is empty", () => {
    const outputs = deriveWorkbenchOutputs({
      cart: createEmptyCart(),
      candidate: CANDIDATE,
      selectedRecipe: null,
    });
    expect(outputs.basis.usingCaptureOnly).toBe(true);
    expect(outputs.recipeState.recommended).toBe("fix");
    expect(outputs.taskSpecJson).toContain('"recipe": "fix"');
    expect(outputs.receipt).not.toBeNull();
    expect(outputs.receipt?.generated).toEqual(
      expect.arrayContaining(["Recipe: fix", "Task kind: fix_issue", "Agent instructions"]),
    );
    expect(outputs.nutrition?.status).toBe("has-unknowns");
    expect(outputs.contentTokens).toBeGreaterThan(0);
  });

  it("produces nothing without any source", () => {
    const outputs = deriveWorkbenchOutputs({
      cart: createEmptyCart(),
      candidate: null,
      selectedRecipe: null,
    });
    expect(outputs.agentContext).toBeNull();
    expect(outputs.receipt).toBeNull();
  });
});

describe("recipe selection and gating", () => {
  it("keeps the user selection and recommends the adapter-based recipe", () => {
    const state = resolveRecipeState([CANDIDATE], "learn");
    expect(state.selected).toBe("learn");
    expect(state.recommended).toBe("fix");
    expect(state.effective).toBe("learn");
  });

  it("falls back to the recommendation when nothing is selected", () => {
    const state = resolveRecipeState([CANDIDATE], null);
    expect(state.effective).toBe("fix");
  });

  it("gates compare on single-source contexts", () => {
    const outputs = deriveWorkbenchOutputs({
      cart: createEmptyCart(),
      candidate: CANDIDATE,
      selectedRecipe: "compare",
    });
    expect(outputs.recipeGate).toEqual({
      status: "insufficient-sources",
      recipe: "compare",
      required: 2,
      actual: 1,
    });
    expect(recipeGateMessage(outputs.recipeGate!)).toBe("Compare needs at least 2 sources.");
    expect(outputs.agentContext).toBeNull();
  });
});

describe("cart interactions", () => {
  it("adds the candidate through normal cart semantics", () => {
    const result = addCandidateToCart(createEmptyCart(), CANDIDATE);
    expect(result.status).toBe("added");
    if (result.status === "added") {
      expect(primarySourceId(result.cart)).toBe(CANDIDATE.id);
      const again = addCandidateToCart(result.cart, CANDIDATE);
      expect(again.status).toBe("duplicate");
    }
  });

  it("never duplicates the same page in the cart", () => {
    let cart: ContextCart = createEmptyCart();
    const first = addContextSource(cart, makeFullPageItem());
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    cart = first.cart;
    const samePageCandidate = createCandidateContextItem(ISSUE_DOC, {
      captureId: "capture-x",
      url: "https://github.com/o/r/issues/12",
      title: "Broken feature",
      capturedAt: "2026-09-01T00:00:00.000Z",
    });
    const duplicate = addContextSource(cart, samePageCandidate as ContextSourceItem);
    expect(duplicate.status).toBe("duplicate");
  });
});
