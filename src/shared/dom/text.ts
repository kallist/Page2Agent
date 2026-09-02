/**
 * Shared site-neutral DOM text utilities.
 * Used by both the generic article adapter and the GitHub issue adapter.
 * No Readability dependency, no site-specific policy.
 */

const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FORM",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "SVG",
  "MATH",
  "HEAD",
]);

/**
 * Block-level tags act as word boundaries inside text collection (e.g. a
 * nested <ul> inside an <li>, or table cells) so concatenated text keeps
 * spaces between segments.
 */
const TEXT_BOUNDARY_TAGS = new Set([
  "P",
  "DIV",
  "UL",
  "OL",
  "LI",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "PRE",
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SECTION",
  "ARTICLE",
  "FIGURE",
  "FIGCAPTION",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "MAIN",
  "NAV",
  "HR",
  "FORM",
]);

/** Normalize whitespace for ordinary text (NBSP → space, collapse runs). */
export function normalizeInlineText(raw: string): string {
  return raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Visible semantic text of a node; <br> counts as whitespace, skipped tags excluded. */
export function getNormalizedText(node: Node): string {
  const parts: string[] = [];
  collectText(node, parts);
  return normalizeInlineText(parts.join(""));
}

function collectText(node: Node, parts: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent ?? "");
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const element = node as Element;
  if (SKIPPED_TAGS.has(element.tagName)) {
    return;
  }
  if (element.tagName === "BR") {
    parts.push(" ");
    return;
  }
  if (TEXT_BOUNDARY_TAGS.has(element.tagName)) {
    parts.push(" ");
  }
  for (const child of node.childNodes) {
    collectText(child, parts);
  }
  if (TEXT_BOUNDARY_TAGS.has(element.tagName)) {
    parts.push(" ");
  }
}
