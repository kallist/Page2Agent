import { describe, expect, it } from "vitest";
import { Page2AgentError, Page2AgentErrorCode, userSafeMessage } from "../../../src/core";

const ADR_REQUIRED_CODES = [
  "UNSUPPORTED_PAGE",
  "RESTRICTED_PAGE",
  "NO_CONTENT_FOUND",
  "PAGE_NAVIGATED",
  "CONTENT_TOO_LARGE",
  "CAPTURE_FAILED",
  "INVALID_MESSAGE",
  "INVALID_DOCUMENT",
  "CLIPBOARD_FAILED",
  "DOWNLOAD_FAILED",
] as const;

describe("Page2AgentErrorCode", () => {
  it("exposes all ADR-required error codes", () => {
    for (const code of ADR_REQUIRED_CODES) {
      expect(Page2AgentErrorCode[code]).toBe(code);
    }
  });

  it("provides a non-empty user-safe message for every code", () => {
    for (const code of Object.values(Page2AgentErrorCode)) {
      expect(userSafeMessage(code).length).toBeGreaterThan(0);
    }
  });
});

describe("Page2AgentError", () => {
  it("is a proper Error subclass with code and safe default message", () => {
    const error = new Page2AgentError(Page2AgentErrorCode.RESTRICTED_PAGE);
    expect(error).toBeInstanceOf(Page2AgentError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("Page2AgentError");
    expect(error.code).toBe(Page2AgentErrorCode.RESTRICTED_PAGE);
    expect(error.message).toBe("This browser page cannot be captured.");
    expect(userSafeMessage(Page2AgentErrorCode.NO_CONTENT_FOUND)).toBe(
      "Unable to find meaningful page content.",
    );
    expect(userSafeMessage(Page2AgentErrorCode.CONTENT_TOO_LARGE)).toBe(
      "This page is too large to capture safely.",
    );
  });

  it("supports a custom message and an internal cause", () => {
    const cause = new Error("raw internal detail");
    const error = new Page2AgentError(Page2AgentErrorCode.CAPTURE_FAILED, {
      message: "Custom safe message",
      cause,
    });
    expect(error.message).toBe("Custom safe message");
    expect(error.cause).toBe(cause);
  });

  it("never embeds the raw cause/stack in the user-visible message", () => {
    const cause = new Error("internal stack trace detail");
    const error = new Page2AgentError(Page2AgentErrorCode.CAPTURE_FAILED, {
      cause,
    });
    expect(error.message).not.toContain("stack");
    expect(error.message).not.toContain(cause.message);
  });

  it("never stores webpage content", () => {
    const error = new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
    expect(JSON.stringify(error)).not.toContain("content");
    expect(error).not.toHaveProperty("document");
    expect(error).not.toHaveProperty("blocks");
  });
});
