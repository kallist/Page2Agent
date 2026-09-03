import { describe, expect, it } from "vitest";
import {
  CONTEXT_ROLES,
  contextSourceDedupeKey,
  isContextRole,
  isContextSourceItem,
} from "../../../../src/core/workbench/context-source";
import {
  makeFullPageItem,
  makeSelectionItem,
} from "../../../helpers/workbench-fixtures";

describe("context roles", () => {
  it("defines exactly the five documented roles", () => {
    expect([...CONTEXT_ROLES]).toEqual([
      "task",
      "reference",
      "evidence",
      "example",
      "selection",
    ]);
  });

  it("validates roles strictly", () => {
    expect(isContextRole("task")).toBe(true);
    expect(isContextRole("bookmark")).toBe(false);
    expect(isContextRole(undefined)).toBe(false);
  });
});

describe("ContextSourceItem validation", () => {
  it("accepts well-formed full-page and selection items", () => {
    expect(isContextSourceItem(makeFullPageItem())).toBe(true);
    expect(isContextSourceItem(makeSelectionItem())).toBe(true);
  });

  it("requires selection details for picked sources", () => {
    const withoutDetails = makeSelectionItem({ scope: "selection", selection: undefined });
    expect(isContextSourceItem(withoutDetails)).toBe(false);
    const withDetails = makeSelectionItem({
      scope: "selection",
      selection: { regions: 2, labels: ["Architecture", "API"] },
    });
    expect(isContextSourceItem(withDetails)).toBe(true);
  });

  it("rejects unknown keys and missing identity fields", () => {
    const { id: _id, ...missingId } = makeFullPageItem();
    expect(isContextSourceItem(missingId)).toBe(false);
    expect(isContextSourceItem({ ...makeFullPageItem(), extra: true })).toBe(false);
    expect(isContextSourceItem({ ...makeFullPageItem(), role: "bookmark" })).toBe(false);
    expect(isContextSourceItem({ ...makeFullPageItem(), primary: "yes" })).toBe(false);
  });

  it("never trusts a non-document payload", () => {
    const item = makeFullPageItem();
    expect(
      isContextSourceItem({ ...item, document: { ...item.document, blocks: [] } }),
    ).toBe(false);
  });

  it("computes deterministic dedupe keys for full-page items", () => {
    const a = makeFullPageItem();
    const b = makeFullPageItem({ id: "item-2", captureId: "capture-2" });
    expect(contextSourceDedupeKey(a)).toBe(contextSourceDedupeKey(b));
  });

  it("keeps selection dedupe keys distinct per pick session", () => {
    const a = makeSelectionItem();
    const b = makeSelectionItem({ id: "item-selection-2", captureId: "capture-other" });
    expect(contextSourceDedupeKey(a)).not.toBe(contextSourceDedupeKey(b));
  });
});
