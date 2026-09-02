/**
 * Pure URL normalization utilities with explicit protocol policies.
 *
 * Page-provided URLs are untrusted input. Link (navigation) URLs may use
 * http/https/mailto; asset URLs only http/https. javascript:, vbscript:,
 * data: and any other protocol are rejected by the allow-list. Relative URLs
 * are resolved against the source URL into absolute form.
 */

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const ASSET_PROTOCOLS = new Set(["http:", "https:"]);

function parseUrl(rawUrl: string, baseUrl?: string): URL | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl);
  } catch {
    return null; // malformed input: never crash, never trust
  }
}

/** True when `value` is an absolute http/https URL (asset-safe). */
export function isSafeAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const url = parseUrl(value);
  return url !== null && ASSET_PROTOCOLS.has(url.protocol);
}

/** True when `value` is an absolute http/https/mailto URL (link-safe). */
export function isSafeLinkUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const url = parseUrl(value);
  return url !== null && LINK_PROTOCOLS.has(url.protocol);
}

/**
 * Normalize a navigation/link URL into canonical absolute form, or null when
 * unsafe or unparseable. `baseUrl` resolves relative URLs.
 */
export function normalizeLinkUrl(rawUrl: string, baseUrl?: string): string | null {
  const url = parseUrl(rawUrl, baseUrl);
  if (url === null || !LINK_PROTOCOLS.has(url.protocol)) {
    return null;
  }
  return url.toString();
}

/**
 * Normalize an asset URL into canonical absolute form, or null when unsafe or
 * unparseable. Asset URLs are restricted to http/https.
 */
export function normalizeAssetUrl(rawUrl: string, baseUrl?: string): string | null {
  const url = parseUrl(rawUrl, baseUrl);
  if (url === null || !ASSET_PROTOCOLS.has(url.protocol)) {
    return null;
  }
  return url.toString();
}
