import { describe, expect, it } from "vitest";
import { createPreview, PREVIEW_CHARACTER_LIMIT } from "../../../../src/extension/sidepanel/preview";

describe("createPreview", () => {
  it("returns the full text when under or at the limit", () => {
    expect(createPreview("short", 20)).toEqual({ text: "short", truncated: false });
    expect(createPreview("x".repeat(20), 20)).toEqual({ text: "x".repeat(20), truncated: false });
  });

  it("truncates and flags text over the limit", () => {
    const preview = createPreview("a".repeat(25), 20);
    expect(preview).toEqual({ text: "a".repeat(20), truncated: true });
  });

  it("uses the default preview limit", () => {
    expect(PREVIEW_CHARACTER_LIMIT).toBe(20_000);
    const preview = createPreview("y".repeat(20_001));
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBe(20_000);
  });

  it("never mutates the source", () => {
    const source = "z".repeat(100);
    const preview = createPreview(source, 10);
    expect(source).toBe("z".repeat(100));
    expect(preview.text).not.toBe(source);
  });

  it("never splits surrogate pairs at the boundary", () => {
    const source = "a😀b";
    const preview = createPreview(source, 2);
    expect(preview).toEqual({ text: "a😀", truncated: true });
  });

  it("counts by code points, not UTF-16 units", () => {
    const source = "😀".repeat(5);
    expect(createPreview(source, 3)).toEqual({ text: "😀".repeat(3), truncated: true });
  });
});
