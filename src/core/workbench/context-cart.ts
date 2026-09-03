/**
 * ContextCart — the user's selected multi-source context (V1.1).
 *
 * Pure, immutable, deterministic reducer operations over ContextSourceItem[].
 * The cart never touches browser storage, React, or serialization; extension
 * storage adapters own persistence. Every op re-validates its output so an
 * invariant bug fails loudly at the domain boundary.
 */
import {
  hasOnlyAllowedKeys,
  isNonNegativeSafeInteger,
  isRecord,
} from "../validation/primitives";
import { Page2AgentError, Page2AgentErrorCode } from "../errors";
import { isContextSourceItem, contextSourceDedupeKey } from "./context-source";
import type { ContextRole, ContextSourceItem } from "./context-source";
import { estimateBlocksTokens } from "./token-estimate";

export const CONTEXT_CART_SCHEMA_VERSION = 1 as const;
/** Hard cart cap — keeps the cart light and session storage bounded. */
export const MAX_CONTEXT_CART_ITEMS = 12;

export interface CartUndoSnapshot {
  removed: ContextSourceItem[];
  /** Original index of each removed item (same order as `removed`). */
  indices: number[];
}

export interface ContextCart {
  schemaVersion: typeof CONTEXT_CART_SCHEMA_VERSION;
  items: ContextSourceItem[];
  /** Single-shot undo for the last destructive action (remove / clear). */
  undo?: CartUndoSnapshot;
}

const UNDO_KEYS = ["removed", "indices"];
const CART_KEYS = ["schemaVersion", "items", "undo"];

function isCartUndoSnapshot(value: unknown): value is CartUndoSnapshot {
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, UNDO_KEYS) &&
    Array.isArray(value.removed) &&
    value.removed.every(isContextSourceItem) &&
    Array.isArray(value.indices) &&
    value.indices.length === value.removed.length &&
    value.indices.every(isNonNegativeSafeInteger)
  );
}

export function isContextCart(value: unknown): value is ContextCart {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, CART_KEYS) ||
    value.schemaVersion !== CONTEXT_CART_SCHEMA_VERSION ||
    !Array.isArray(value.items) ||
    !value.items.every(isContextSourceItem)
  ) {
    return false;
  }
  const primaryCount = value.items.filter((item: ContextSourceItem) => item.primary).length;
  if (primaryCount > 1) {
    return false; // at most one primary — cart ops enforce this invariant
  }
  if (value.undo !== undefined && !isCartUndoSnapshot(value.undo)) {
    return false;
  }
  return true;
}

export function createEmptyCart(): ContextCart {
  return { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items: [] };
}

export type AddSourceResult =
  | { status: "added"; cart: ContextCart; item: ContextSourceItem }
  | { status: "duplicate"; cart: ContextCart; existingId: string }
  | { status: "full"; cart: ContextCart };

/**
 * Add one source. A source is a duplicate when the cart already holds an
 * equivalent context unit: full-page sources match on (url + kind + scope)
 * so re-capturing the same page cannot silently stack copies; picked
 * selections match on (captureId + scope + selection labels) because the
 * same pick session is one unit.
 */
export function addContextSource(cart: ContextCart, item: ContextSourceItem): AddSourceResult {
  const cartAfterUndoReset = withoutUndo(cart);
  const duplicate = findDuplicate(cartAfterUndoReset.items, item);
  if (duplicate !== undefined) {
    return { status: "duplicate", cart: cartAfterUndoReset, existingId: duplicate.id };
  }
  if (cartAfterUndoReset.items.length >= MAX_CONTEXT_CART_ITEMS) {
    return { status: "full", cart: cartAfterUndoReset };
  }
  let items = [...cartAfterUndoReset.items];
  if (item.primary) {
    items = items.map((existing) =>
      existing.primary ? { ...existing, primary: false } : existing,
    );
  }
  const next: ContextCart = { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items: [...items, item] };
  return { status: "added", cart: validate(next), item };
}

export type RemoveResult =
  | { status: "removed"; cart: ContextCart; item: ContextSourceItem }
  | { status: "not-found"; cart: ContextCart };

export function removeContextSource(cart: ContextCart, itemId: string): RemoveResult {
  const index = cart.items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return { status: "not-found", cart: withoutUndo(cart) };
  }
  const removed = cart.items[index];
  const items = cart.items.filter((item) => item.id !== itemId);
  const next: ContextCart = {
    schemaVersion: CONTEXT_CART_SCHEMA_VERSION,
    items: promoteAfterRemoval(items),
    undo: { removed: [removed], indices: [index] },
  };
  return { status: "removed", cart: validate(next), item: removed };
}

export type ReorderResult =
  | { status: "moved"; cart: ContextCart }
  | { status: "not-found"; cart: ContextCart };

/** Move an item to a new index (stable: removes then inserts at target).
 *
 * Insertion index semantics: removing the item shifts every later sibling
 * left by one, so inserting the removed item back at the (clamped) target
 * index yields the requested final position for BOTH directions — e.g.
 * 0 → 1: remove 0 → [b,c,…], insert at 1 → [b,a,c,…]; 3 → 1: remove 3 →
 * [a,b,c,…], insert at 1 → [a,x,b,c,…].
 */
export function moveContextSource(cart: ContextCart, itemId: string, toIndex: number): ReorderResult {
  const current = cart.items.findIndex((item) => item.id === itemId);
  if (current < 0) {
    return { status: "not-found", cart: withoutUndo(cart) };
  }
  if (current === clampIndex(toIndex, cart.items.length)) {
    // No-op move: report success without dropping the undo snapshot.
    return { status: "moved", cart };
  }
  const target = clampIndex(toIndex, cart.items.length);
  const without = cart.items.filter((item) => item.id !== itemId);
  const items = [...without.slice(0, target), cart.items[current], ...without.slice(target)];
  const next: ContextCart = { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items };
  return { status: "moved", cart: validate(next) };
}

export type RoleResult =
  | { status: "role-set"; cart: ContextCart }
  | { status: "not-found"; cart: ContextCart };

export function setContextSourceRole(cart: ContextCart, itemId: string, role: ContextRole): RoleResult {
  if (!cart.items.some((item) => item.id === itemId)) {
    return { status: "not-found", cart: withoutUndo(cart) };
  }
  const items = cart.items.map((item) =>
    item.id === itemId ? { ...item, role } : item,
  );
  const next: ContextCart = { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items };
  return { status: "role-set", cart: validate(next) };
}

export type PrimaryResult =
  | { status: "primary-set"; cart: ContextCart }
  | { status: "not-found"; cart: ContextCart };

/** Promote one item to primary; every other item is demoted. */
export function setPrimaryContextSource(cart: ContextCart, itemId: string): PrimaryResult {
  if (!cart.items.some((item) => item.id === itemId)) {
    return { status: "not-found", cart: withoutUndo(cart) };
  }
  const items = cart.items.map((item) => ({
    ...item,
    primary: item.id === itemId,
  }));
  const next: ContextCart = { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items };
  return { status: "primary-set", cart: validate(next) };
}

export type ClearResult = { status: "cleared"; cart: ContextCart };

export function clearContextCart(cart: ContextCart): ClearResult {
  const removed = cart.items;
  const indices = removed.map((_, index) => index);
  const next: ContextCart = {
    schemaVersion: CONTEXT_CART_SCHEMA_VERSION,
    items: [],
    undo: removed.length > 0 ? { removed, indices } : undefined,
  };
  return { status: "cleared", cart: validate(next) };
}

export type UndoResult =
  | { status: "restored"; cart: ContextCart }
  | { status: "nothing-to-undo"; cart: ContextCart };

/** Restore the last destructive action (single shot; further ops clear it). */
export function undoContextCartChange(cart: ContextCart): UndoResult {
  if (cart.undo === undefined || cart.undo.removed.length === 0) {
    return { status: "nothing-to-undo", cart };
  }
  const { removed, indices } = cart.undo;
  let items = [...cart.items];
  for (let i = 0; i < removed.length; i += 1) {
    const index = Math.min(indices[i], items.length);
    items = [...items.slice(0, index), removed[i], ...items.slice(index)];
  }
  items = restorePrimaryState(items, removed);
  const next: ContextCart = { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items };
  return { status: "restored", cart: validate(next) };
}

/**
 * Re-establish the at-most-one-primary invariant after an undo. Removing the
 * primary promotes the first remaining item, so restoring must demote that
 * stand-in when the removed primary comes back.
 */
function restorePrimaryState(
  items: ContextSourceItem[],
  removed: readonly ContextSourceItem[],
): ContextSourceItem[] {
  const removedPrimary = removed.find((item) => item.primary);
  if (removedPrimary !== undefined) {
    return items.map((item) => ({ ...item, primary: item.id === removedPrimary.id }));
  }
  if (!items.some((item) => item.primary)) {
    return promoteFirstToPrimary(items);
  }
  return items;
}

export interface CartTotals {
  count: number;
  tokenEstimate: number;
  /** Count of sources per kind, for receipts and multi-source status. */
  kinds: Partial<Record<ContextSourceItem["sourceKind"], number>>;
}

export function computeCartTotals(cart: ContextCart): CartTotals {
  let tokenEstimate = 0;
  const kinds: Partial<Record<ContextSourceItem["sourceKind"], number>> = {};
  for (const item of cart.items) {
    tokenEstimate += estimateBlocksTokens(item.document.blocks);
    kinds[item.sourceKind] = (kinds[item.sourceKind] ?? 0) + 1;
  }
  return { count: cart.items.length, tokenEstimate, kinds };
}

export function findCartItem(cart: ContextCart, itemId: string): ContextSourceItem | undefined {
  return cart.items.find((item) => item.id === itemId);
}

export function primaryContextSource(cart: ContextCart): ContextSourceItem | undefined {
  return cart.items.find((item) => item.primary) ?? cart.items[0];
}

/**
 * Convenience defaults applied when an item enters an EMPTY cart: the first
 * source leads the task (role task + primary). Every later item defaults to
 * reference and never steals the primary flag. Roles and primary remain user
 * choices afterwards — these helpers only shape the starting point.
 */
export function suggestInitialRole(_item: ContextSourceItem, cart: ContextCart): ContextRole {
  return cart.items.length === 0 ? "task" : "reference";
}

export function suggestInitialPrimary(_item: ContextSourceItem, cart: ContextCart): boolean {
  return cart.items.length === 0;
}

function findDuplicate(items: readonly ContextSourceItem[], candidate: ContextSourceItem): ContextSourceItem | undefined {
  return items.find((existing) => contextSourceDedupeKey(existing) === contextSourceDedupeKey(candidate));
}

/** Removing the primary promotes the first remaining item (deterministic). */
function promoteAfterRemoval(items: ContextSourceItem[]): ContextSourceItem[] {
  if (items.some((item) => item.primary)) {
    return items;
  }
  return promoteFirstToPrimary(items);
}

function promoteFirstToPrimary(items: ContextSourceItem[]): ContextSourceItem[] {
  if (items.length === 0) {
    return items;
  }
  return items.map((item, index) => (index === 0 ? { ...item, primary: true } : item));
}

function withoutUndo(cart: ContextCart): ContextCart {
  return cart.undo === undefined ? cart : { schemaVersion: CONTEXT_CART_SCHEMA_VERSION, items: cart.items };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isSafeInteger(index)) {
    return 0;
  }
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

function validate(cart: ContextCart): ContextCart {
  if (!isContextCart(cart)) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "Context Cart operation produced an invalid cart.",
    });
  }
  return cart;
}
