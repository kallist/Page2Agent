import { describe, expect, it } from "vitest";
import { createCaptureId, isPageContext } from "../../../src/core";

const VALID_CONTEXT = {
  captureId: "11111111-1111-4111-8111-111111111111",
  tabId: 7,
  url: "https://example.com/docs/page",
  title: "Example page",
  capturedAt: "2026-08-30T00:00:00.000Z",
};

describe("PageContext", () => {
  it("accepts a valid context", () => {
    expect(isPageContext(VALID_CONTEXT)).toBe(true);
  });

  it("rejects an empty captureId", () => {
    expect(isPageContext({ ...VALID_CONTEXT, captureId: "" })).toBe(false);
  });

  it("rejects invalid tabId values", () => {
    for (const tabId of [-1, 1.5, NaN, Infinity]) {
      expect(isPageContext({ ...VALID_CONTEXT, tabId })).toBe(false);
    }
  });

  it("rejects invalid capturedAt values", () => {
    for (const capturedAt of ["", "not-a-date", "yesterday"]) {
      expect(isPageContext({ ...VALID_CONTEXT, capturedAt })).toBe(false);
    }
  });

  it("rejects a whitespace-only title", () => {
    expect(isPageContext({ ...VALID_CONTEXT, title: "   " })).toBe(false);
  });

  it("rejects unknown extra fields (strict key policy)", () => {
    expect(isPageContext({ ...VALID_CONTEXT, extra: true })).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(
      isPageContext({
        tabId: 7,
        url: "https://example.com/docs/page",
        title: "Example page",
        capturedAt: "2026-08-30T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("does not mutate frozen input", () => {
    expect(isPageContext(Object.freeze({ ...VALID_CONTEXT }))).toBe(true);
  });
});

describe("createCaptureId", () => {
  it("returns unique non-empty UUID strings", () => {
    const first = createCaptureId();
    const second = createCaptureId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(first).not.toBe(second);
  });
});
