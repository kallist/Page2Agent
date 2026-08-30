import { describe, expect, it } from "vitest";
import {
  isSafeAbsoluteUrl,
  isSafeLinkUrl,
  normalizeAssetUrl,
  normalizeLinkUrl,
} from "../../../src/core";

const BASE = "https://example.com/docs/page";

describe("normalizeLinkUrl", () => {
  it("resolves relative URLs against the base into absolute form", () => {
    expect(normalizeLinkUrl("../api", BASE)).toBe("https://example.com/api");
    expect(normalizeLinkUrl("/image.png", BASE)).toBe("https://example.com/image.png");
    expect(normalizeLinkUrl("guide", BASE)).toBe("https://example.com/docs/guide");
  });

  it("keeps query and fragment semantics", () => {
    expect(normalizeLinkUrl("../api?x=1#top", BASE)).toBe("https://example.com/api?x=1#top");
    expect(normalizeLinkUrl("https://example.com/a?q=1#f")).toBe("https://example.com/a?q=1#f");
  });

  it("trims surrounding whitespace and passes absolute URLs through", () => {
    expect(normalizeLinkUrl("  https://example.com/x  ")).toBe("https://example.com/x");
    expect(normalizeLinkUrl("https://example.com/docs/page")).toBe("https://example.com/docs/page");
  });

  it("resolves protocol-relative URLs with the base scheme", () => {
    expect(normalizeLinkUrl("//cdn.example.com/app.js", BASE)).toBe(
      "https://cdn.example.com/app.js",
    );
  });

  it("allows mailto for links", () => {
    expect(normalizeLinkUrl("mailto:help@example.com")).toBe("mailto:help@example.com");
  });

  it("rejects executable, data and empty URLs", () => {
    for (const raw of [
      "javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://",
      "",
      "   ",
    ]) {
      expect(normalizeLinkUrl(raw, BASE)).toBeNull();
    }
  });

  it("rejects malformed URLs when no base can rescue them", () => {
    expect(normalizeLinkUrl("not a url")).toBeNull();
    // With a base, an opaque relative string is a valid relative path:
    expect(normalizeLinkUrl("not a url", BASE)).toBe("https://example.com/docs/not%20a%20url");
  });
});

describe("normalizeAssetUrl", () => {
  it("normalizes http/https asset URLs", () => {
    expect(normalizeAssetUrl("../img/a.png", BASE)).toBe("https://example.com/img/a.png");
    expect(normalizeAssetUrl("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("rejects mailto and unsafe protocols for assets", () => {
    expect(normalizeAssetUrl("mailto:help@example.com")).toBeNull();
    expect(normalizeAssetUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeAssetUrl("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(normalizeAssetUrl("vbscript:msgbox(1)")).toBeNull();
  });
});

describe("link vs asset protocol policy difference", () => {
  it("mailto is a valid link but never a valid asset", () => {
    expect(isSafeLinkUrl("mailto:help@example.com")).toBe(true);
    expect(isSafeAbsoluteUrl("mailto:help@example.com")).toBe(false);
  });

  it("isSafeAbsoluteUrl requires http/https", () => {
    expect(isSafeAbsoluteUrl("https://example.com/a.png")).toBe(true);
    expect(isSafeAbsoluteUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAbsoluteUrl("relative/path")).toBe(false);
    expect(isSafeAbsoluteUrl(42)).toBe(false);
  });
});
