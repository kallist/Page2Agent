import { describe, expect, it } from "vitest";
import { isSameCapturedPage } from "../../../../src/extension/messaging/page-url";

const BASE = "https://example.com/docs/page?tab=1";

describe("isSameCapturedPage", () => {
  it("treats identical URLs as the same page", () => {
    expect(isSameCapturedPage(BASE, BASE)).toBe(true);
  });

  it("ignores hash-only changes (fragment is not page identity)", () => {
    expect(isSameCapturedPage(BASE, `${BASE}#section-2`)).toBe(true);
    expect(isSameCapturedPage("https://example.com/a#x", "https://example.com/a#y")).toBe(true);
  });

  it("detects pathname changes", () => {
    expect(isSameCapturedPage(BASE, "https://example.com/docs/other?tab=1")).toBe(false);
    expect(isSameCapturedPage("https://example.com/a", "https://example.com/a/b")).toBe(false);
  });

  it("detects query changes", () => {
    expect(isSameCapturedPage(BASE, "https://example.com/docs/page?tab=2")).toBe(false);
    expect(isSameCapturedPage("https://example.com/a", "https://example.com/a?x=1")).toBe(false);
  });

  it("detects host and protocol changes", () => {
    expect(isSameCapturedPage(BASE, "https://other.example.com/docs/page?tab=1")).toBe(false);
    expect(isSameCapturedPage("https://example.com/a", "http://example.com/a")).toBe(false);
  });

  it("fails safe on unparseable input", () => {
    expect(isSameCapturedPage(BASE, "not a url")).toBe(false);
    expect(isSameCapturedPage("not a url", BASE)).toBe(false);
  });
});
