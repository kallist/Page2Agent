/**
 * Safe Markdown filename generation (application layer, pure).
 *
 * Generic: sanitized document title; GitHub: owner-repo-issue-{number}.
 * Handles invalid filesystem characters, control chars, trailing dots/spaces,
 * reserved Windows device names, length bounds, and a deterministic fallback.
 */
import type { NormalizedDocument } from "../../core";

const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*]/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_BASE_LENGTH = 120;
const FALLBACK_BASE = "page2agent";

/** Replace control characters (code points < 0x20) with "-". */
function mapControlCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    result += (char.codePointAt(0) ?? 0) < 0x20 ? "-" : char;
  }
  return result;
}

export function buildMarkdownFilename(document: NormalizedDocument): string {
  if (document.source.kind === "github_issue") {
    const identityBase =
      `${document.source.owner}-${document.source.repo}-` +
      `issue-${document.source.issueNumber}`;
    return `${sanitizeBaseName(identityBase) || FALLBACK_BASE}.md`;
  }
  return `${sanitizeBaseName(document.metadata.title) || FALLBACK_BASE}.md`;
}

export function sanitizeBaseName(raw: string): string {
  const cleaned = mapControlCharacters(raw)
    .trim()
    .replace(INVALID_FILENAME_CHARACTERS, "-")
    .replace(/\./g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, "");
  if (cleaned.length === 0) {
    return "";
  }
  if (RESERVED_WINDOWS_NAME.test(cleaned)) {
    return `${FALLBACK_BASE}-${cleaned}`;
  }
  return cleaned;
}
