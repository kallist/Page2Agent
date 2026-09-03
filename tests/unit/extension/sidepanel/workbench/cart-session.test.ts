import { describe, expect, it } from "vitest";
import {
  readCart,
  saveCart,
  workbenchCartKey,
  clearCartRecord,
} from "../../../../../src/extension/sidepanel/workbench/cart-session";
import type { SessionStorage } from "../../../../../src/extension/session/session-storage";
import { addContextSource, createEmptyCart } from "../../../../../src/core";
import { makeFullPageItem, makeSelectionItem } from "../../../../../tests/helpers/workbench-fixtures";

function fakeStorage(): SessionStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key) {
      return data[key];
    },
    async set(key, value) {
      data[key] = value;
    },
    async remove(key) {
      delete data[key];
    },
  };
}

describe("cart session persistence", () => {
  it("round-trips a cart under its window key", async () => {
    const storage = fakeStorage();
    let cart = createEmptyCart();
    const first = addContextSource(cart, makeFullPageItem());
    if (first.status !== "added") {
      throw new Error("expected added");
    }
    cart = first.cart;
    const second = addContextSource(cart, makeSelectionItem({ id: "item-sel" }));
    if (second.status !== "added") {
      throw new Error("expected added");
    }
    await saveCart(storage, 3, second.cart);
    expect(storage.data[workbenchCartKey(3)]).toBeDefined();
    const restored = await readCart(storage, 3);
    expect(restored.items).toHaveLength(2);
    expect(restored.items[0].role).toBe("task");
  });

  it("degrades invalid or missing records to an empty cart", async () => {
    const storage = fakeStorage();
    storage.data[workbenchCartKey(3)] = { schemaVersion: 99, items: [] };
    expect((await readCart(storage, 3)).items).toEqual([]);
    expect((await readCart(storage, 4)).items).toEqual([]);
  });

  it("clears the record explicitly", async () => {
    const storage = fakeStorage();
    await saveCart(storage, 3, createEmptyCart());
    await clearCartRecord(storage, 3);
    expect(storage.data[workbenchCartKey(3)]).toBeUndefined();
  });
});
