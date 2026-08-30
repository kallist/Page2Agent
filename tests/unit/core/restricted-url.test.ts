import { describe, expect, it } from "vitest";
import { isRestrictedPageUrl } from "../../../src/core";

describe("isRestrictedPageUrl", () => {
  it("detects browser internal schemes", () => {
    for (const url of [
      "chrome://settings",
      "chrome://newtab",
      "edge://settings",
      "chrome-extension://abc123/",
      "chrome-search://local-ntp/",
      "devtools://devtools/bundled/devtools_app.html",
      "view-source:https://example.com/",
      "about:blank",
      "about:newtab",
      "file:///C:/Users/me/notes.html",
    ]) {
      expect(isRestrictedPageUrl(url)).toBe(true);
    }
  });

  it("detects the Chrome Web Store exactly (not all google.com)", () => {
    expect(isRestrictedPageUrl("https://chromewebstore.google.com/detail/abc")).toBe(true);
    expect(isRestrictedPageUrl("https://google.com")).toBe(false);
    expect(isRestrictedPageUrl("https://www.google.com/search?q=page2agent")).toBe(false);
  });

  it("returns false for normal capturable pages", () => {
    for (const url of [
      "https://example.com/article",
      "http://localhost:5173/",
      "https://github.com/acme/widgets/issues/42",
      "https://chromewebstore.com/",
    ]) {
      expect(isRestrictedPageUrl(url)).toBe(false);
    }
  });

  it("does not crash on unparseable input", () => {
    expect(isRestrictedPageUrl("not a url")).toBe(false);
    expect(isRestrictedPageUrl("")).toBe(false);
  });
});
