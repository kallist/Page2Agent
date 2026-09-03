import { describe, expect, it } from "vitest";
import {
  MAX_CONTEXT_CART_ITEMS,
  addContextSource,
  clearContextCart,
  computeCartTotals,
  createEmptyCart,
  isContextCart,
  moveContextSource,
  primaryContextSource,
  removeContextSource,
  setContextSourceRole,
  setPrimaryContextSource,
  suggestInitialPrimary,
  suggestInitialRole,
  undoContextCartChange,
} from "../../../../src/core/workbench/context-cart";
import type { ContextCart } from "../../../../src/core/workbench/context-cart";
import {
  makeFullPageItem,
  makeSelectionItem,
  makeWebDocument,
} from "../../../helpers/workbench-fixtures";
import type { ContextSourceItem } from "../../../../src/core/workbench/context-source";

function webItem(id: string, url: string, overrides: Partial<ContextSourceItem> = {}): ContextSourceItem {
  const document = makeWebDocument({
    source: { kind: "web", url, site: "example.com" },
    metadata: { title: `Article ${id}`, capturedAt: "2026-01-02T00:00:00.000Z" },
  });
  const item: ContextSourceItem = {
    id,
    captureId: `capture-${id}`,
    url,
    capturedAt: document.metadata.capturedAt,
    title: document.metadata.title,
    sourceKind: "web",
    adapter: { id: "generic-article", name: "Generic Article" },
    scope: "full-page",
    role: "task",
    primary: false,
    document,
    ...overrides,
  };
  return item;
}

describe("cart validation", () => {
  it("accepts an empty cart and rejects malformed ones", () => {
    const empty = createEmptyCart();
    expect(isContextCart(empty)).toBe(true);
    expect(isContextCart({ ...empty, items: "nope" })).toBe(false);
    expect(isContextCart({ schemaVersion: 1, items: [makeFullPageItem(), makeFullPageItem({ id: "x", primary: true })] })).toBe(false);
  });

  it("enforces at most one primary", () => {
    const cart = createEmptyCart();
    const first = addContextSource(cart, makeFullPageItem());
    expect(first.status).toBe("added");
    const second = addContextSource(
      (first as { cart: ContextCart }).cart,
      webItem("item-2", "https://example.com/article-2", { primary: true }),
    );
    if (second.status !== "added") {
      throw new Error("expected added");
    }
    const primaries = second.cart.items.filter((item) => item.primary);
    expect(primaries.length).toBe(1);
    expect(primaries[0].id).toBe("item-2");
  });
});

describe("addContextSource", () => {
  it("adds with suggested defaults on the first item", () => {
    const cart = createEmptyCart();
    const item = makeFullPageItem();
    expect(suggestInitialRole(item, cart)).toBe("task");
    expect(suggestInitialPrimary(item, cart)).toBe(true);
    const result = addContextSource(cart, { ...item, role: "task", primary: true });
    expect(result.status).toBe("added");
    if (result.status === "added") {
      expect(result.cart.items).toHaveLength(1);
      expect(primaryContextSource(result.cart)?.id).toBe(item.id);
    }
  });

  it("detects duplicate full-page sources across captures", () => {
    const cart = createEmptyCart();
    const first = addContextSource(cart, makeFullPageItem());
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    const again = addContextSource(
      first.cart,
      makeFullPageItem({ id: "item-2", captureId: "capture-new" }),
    );
    expect(again.status).toBe("duplicate");
    if (again.status === "duplicate") {
      expect(again.existingId).toBe("item-1");
    }
  });

  it("allows distinct sources from the same page type", () => {
    const cart = createEmptyCart();
    const issue = addContextSource(cart, makeFullPageItem());
    if (issue.status !== "added") {
      throw new Error("expected added");
    }
    const docs = addContextSource(
      issue.cart,
      webItem("item-2", "https://docs.example.com/api"),
    );
    expect(docs.status).toBe("added");
  });

  it("refuses to grow beyond the cart cap", () => {
    let cart = createEmptyCart();
    for (let i = 0; i < MAX_CONTEXT_CART_ITEMS; i += 1) {
      const result = addContextSource(
        cart,
        webItem(`item-${i}`, `https://example.com/article/${i}`),
      );
      if (result.status !== "added") {
        throw new Error(`expected added at ${i}`);
      }
      cart = result.cart;
    }
    const overflow = addContextSource(cart, webItem("overflow", "https://example.com/overflow"));
    expect(overflow.status).toBe("full");
  });
});

describe("cart mutations", () => {
  function cartWithTwoSources(): ContextCart {
    let cart = createEmptyCart();
    const first = addContextSource(cart, makeFullPageItem());
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    cart = first.cart;
    const second = addContextSource(
      cart,
      webItem("item-2", "https://example.com/article-2"),
    );
    if (second.status !== "added") {
      throw new Error("expected added");
    }
    return second.cart;
  }

  it("removes an item and undoes the removal", () => {
    const cart = cartWithTwoSources();
    const removed = removeContextSource(cart, "item-1");
    expect(removed.status).toBe("removed");
    if (removed.status !== "removed") {
      throw new Error("expected removed");
    }
    expect(removed.cart.items.map((item) => item.id)).toEqual(["item-2"]);
    const restored = undoContextCartChange(removed.cart);
    expect(restored.status).toBe("restored");
    if (restored.status === "restored") {
      expect(restored.cart.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    }
  });

  it("promotes the first remaining item when the primary is removed", () => {
    const cart = cartWithTwoSources();
    const removed = removeContextSource(cart, "item-1");
    if (removed.status !== "removed") {
      throw new Error("expected removed");
    }
    expect(primaryContextSource(removed.cart)?.id).toBe("item-2");
  });

  it("reorders items", () => {
    const cart = cartWithTwoSources();
    const moved = moveContextSource(cart, "item-2", 0);
    if (moved.status !== "moved") {
      throw new Error("expected moved");
    }
    expect(moved.cart.items.map((item) => item.id)).toEqual(["item-2", "item-1"]);
  });

  it("moves items downward and reaches the last slot", () => {
    let cart = createEmptyCart();
    for (const item of ["a", "b", "c", "d"].map((id) => webItem(`item-${id}`, `https://example.com/${id}`))) {
      const added = addContextSource(cart, item);
      if (added.status !== "added") {
        throw new Error("expected added");
      }
      cart = added.cart;
    }
    const down = moveContextSource(cart, "item-a", 2);
    if (down.status !== "moved") {
      throw new Error("expected moved");
    }
    expect(down.cart.items.map((item) => item.id)).toEqual([
      "item-b",
      "item-c",
      "item-a",
      "item-d",
    ]);
    const toLast = moveContextSource(down.cart, "item-d", 0);
    if (toLast.status !== "moved") {
      throw new Error("expected moved");
    }
    expect(toLast.cart.items.map((item) => item.id)).toEqual([
      "item-d",
      "item-b",
      "item-c",
      "item-a",
    ]);
    const backDown = moveContextSource(toLast.cart, "item-d", 3);
    if (backDown.status !== "moved") {
      throw new Error("expected moved");
    }
    expect(backDown.cart.items.map((item) => item.id)).toEqual([
      "item-b",
      "item-c",
      "item-a",
      "item-d",
    ]);
  });

  it("keeps the undo snapshot on no-op moves", () => {
    const cart = cartWithTwoSources();
    const removed = removeContextSource(cart, "item-1");
    if (removed.status !== "removed") {
      throw new Error("expected removed");
    }
    const noop = moveContextSource(removed.cart, "item-2", 0);
    if (noop.status !== "moved") {
      throw new Error("expected moved");
    }
    const restored = undoContextCartChange(noop.cart);
    expect(restored.status).toBe("restored");
  });

  it("sets roles and primary deterministically", () => {
    const cart = cartWithTwoSources();
    const roleSet = setContextSourceRole(cart, "item-2", "evidence");
    if (roleSet.status !== "role-set") {
      throw new Error("expected role-set");
    }
    expect(roleSet.cart.items[1].role).toBe("evidence");
    const primarySet = setPrimaryContextSource(roleSet.cart, "item-2");
    if (primarySet.status !== "primary-set") {
      throw new Error("expected primary-set");
    }
    expect(primarySet.cart.items[0].primary).toBe(false);
    expect(primarySet.cart.items[1].primary).toBe(true);
  });

  it("clears the cart and undoes the clear", () => {
    const cart = cartWithTwoSources();
    const cleared = clearContextCart(cart);
    expect(cleared.cart.items).toHaveLength(0);
    const restored = undoContextCartChange(cleared.cart);
    expect(restored.status).toBe("restored");
    if (restored.status === "restored") {
      expect(restored.cart.items).toHaveLength(2);
    }
  });

  it("keeps undo single-shot (real later changes forget the snapshot)", () => {
    const cart = cartWithTwoSources();
    const removed = removeContextSource(cart, "item-1");
    if (removed.status !== "removed") {
      throw new Error("expected removed");
    }
    // A no-op move (same position) is not a state change and must NOT drop
    // the undo snapshot...
    const noop = moveContextSource(removed.cart, "item-2", 0);
    if (noop.status !== "moved") {
      throw new Error("expected moved");
    }
    const restored = undoContextCartChange(noop.cart);
    expect(restored.status).toBe("restored");

    // ...but any real change afterwards forgets the previous snapshot.
    const removedAgain = removeContextSource(restored.cart, "item-2");
    if (removedAgain.status !== "removed") {
      throw new Error("expected removed");
    }
    const added = addContextSource(removedAgain.cart, webItem("item-new", "https://example.com/new"));
    if (added.status !== "added") {
      throw new Error("expected added");
    }
    const nothing = undoContextCartChange(added.cart);
    expect(nothing.status).toBe("nothing-to-undo");
  });

  it("reports missing items without corrupting state", () => {
    const cart = cartWithTwoSources();
    expect(removeContextSource(cart, "ghost").status).toBe("not-found");
    expect(setContextSourceRole(cart, "ghost", "task").status).toBe("not-found");
    expect(setPrimaryContextSource(cart, "ghost").status).toBe("not-found");
    expect(moveContextSource(cart, "ghost", 0).status).toBe("not-found");
  });
});

describe("cart totals", () => {
  it("computes counts and token estimates over all sources", () => {
    let cart = createEmptyCart();
    const first = addContextSource(cart, makeFullPageItem());
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    cart = first.cart;
    const selection = makeSelectionItem({ id: "item-sel" });
    const second = addContextSource(cart, selection);
    if (second.status !== "added") {
      throw new Error("expected added");
    }
    const totals = computeCartTotals(second.cart);
    expect(totals.count).toBe(2);
    expect(totals.tokenEstimate).toBeGreaterThan(0);
    expect(totals.kinds.github_issue).toBe(1);
    expect(totals.kinds.web).toBe(1);
  });
});
