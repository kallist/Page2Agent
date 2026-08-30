/**
 * Pure detection of browser pages where programmatic content-script injection
 * is not possible (or that V0.1 does not support capturing).
 *
 * Explicit allow/deny by scheme and by known restricted hosts — NOT
 * "anything non-http is restricted" (file:// is treated as restricted because
 * V0.1 does not support capturing local files).
 */

const RESTRICTED_SCHEMES = new Set([
  "chrome:",
  "edge:",
  "chrome-extension:",
  "chrome-search:",
  "devtools:",
  "view-source:",
  "about:",
  "file:",
]);

const CHROME_WEB_STORE_HOST = "chromewebstore.google.com";

export function isRestrictedPageUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    // Unparseable input is not a known restricted page; other checks (URL
    // validity) decide what to do with it.
    return false;
  }
  if (RESTRICTED_SCHEMES.has(url.protocol)) {
    return true;
  }
  if (url.protocol === "https:" && url.hostname === CHROME_WEB_STORE_HOST) {
    return true;
  }
  return false;
}
