/**
 * Structured error codes for Page2Agent.
 * Const object + inferred union (no TS enum); INVALID_REGISTRY is an internal
 * configuration error code added beyond the ADR-001 minimum set.
 */
export const Page2AgentErrorCode = {
  UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
  RESTRICTED_PAGE: "RESTRICTED_PAGE",
  NO_CONTENT_FOUND: "NO_CONTENT_FOUND",
  PAGE_NAVIGATED: "PAGE_NAVIGATED",
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
  CAPTURE_FAILED: "CAPTURE_FAILED",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  INVALID_DOCUMENT: "INVALID_DOCUMENT",
  CLIPBOARD_FAILED: "CLIPBOARD_FAILED",
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  INVALID_REGISTRY: "INVALID_REGISTRY",
} as const;

export type Page2AgentErrorCode =
  (typeof Page2AgentErrorCode)[keyof typeof Page2AgentErrorCode];

/**
 * Code → safe, user-readable message. Raw stack traces and internal causes
 * must never reach the UI.
 */
export const USER_SAFE_ERROR_MESSAGES: Record<Page2AgentErrorCode, string> = {
  UNSUPPORTED_PAGE: "This page type is not supported.",
  RESTRICTED_PAGE: "This browser page cannot be captured.",
  NO_CONTENT_FOUND: "Unable to find meaningful page content.",
  PAGE_NAVIGATED: "The page changed during capture.",
  CONTENT_TOO_LARGE: "This page is too large to capture safely.",
  CAPTURE_FAILED: "The page could not be captured.",
  INVALID_MESSAGE: "The extension received an invalid message.",
  INVALID_DOCUMENT: "The captured content is invalid.",
  CLIPBOARD_FAILED: "Could not copy to the clipboard.",
  DOWNLOAD_FAILED: "Could not download the file.",
  INVALID_REGISTRY: "The extension configuration is invalid.",
};

export function userSafeMessage(code: Page2AgentErrorCode): string {
  return USER_SAFE_ERROR_MESSAGES[code];
}
