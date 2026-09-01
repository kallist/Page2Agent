// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../../../../src/extension/sidepanel/clipboard";
import { downloadMarkdown } from "../../../../src/extension/sidepanel/download";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copyTextToClipboard", () => {
  it("writes the full text via navigator.clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyTextToClipboard("full agent context");
    expect(writeText).toHaveBeenCalledWith("full agent context");
  });

  it("propagates clipboard failures as rejections", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("denied")) },
    });
    await expect(copyTextToClipboard("x")).rejects.toThrow();
  });
});

describe("downloadMarkdown", () => {
  it("creates a Blob, clicks an anchor with the filename and revokes the URL", () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:page2agent-1");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);

    downloadMarkdown("example.md", "full markdown");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(blob.size).toBe("full markdown".length);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:page2agent-1");
  });

  it("sets the download filename on the anchor", () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:page2agent-2"),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);

    const anchors: HTMLAnchorElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreate(tagName);
      if (tagName === "a") {
        anchors.push(element as HTMLAnchorElement);
      }
      return element;
    });

    downloadMarkdown("owner-repo-issue-1.md", "# x");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("owner-repo-issue-1.md");
    expect(anchors[0].href).toBe("blob:page2agent-2");
    expect(document.body.contains(anchors[0])).toBe(false); // anchor removed after click
  });
});
