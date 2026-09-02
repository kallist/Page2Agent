/**
 * Markdown escaping for serialized domain text. Pure and deterministic.
 *
 * Goal: the rendered Markdown preserves the source's visible text without
 * over-escaping ordinary characters. Markdown escaping is a rendering
 * fidelity concern, NOT a prompt-injection defense (see ADR-001).
 */

/** Escape inline special characters in ordinary semantic text. */
export function escapeMarkdownText(text: string): string {
  return text
    .split("\n")
    .map(escapeMarkdownLine)
    .join("\n");
}

function escapeMarkdownLine(line: string): string {
  let result = line
    .replace(/\\/g, "\\\\")
    .replace(/([*_`[\])])/g, "\\$1");
  // Protect block-level prefixes so plain text cannot turn into Markdown
  // structure (headings, blockquotes, lists, ordered lists).
  result = result.replace(/^(\s*)(#{1,6})(\s)/, "$1\\$2$3");
  result = result.replace(/^(\s*)(>)(\s)/, "$1\\$2$3");
  result = result.replace(/^(\s*)([-+*])(\s)/, "$1\\$2$3");
  result = result.replace(/^(\s*)(\d+)(\.)(\s)/, "$1$2\\.$4");
  return result;
}

/**
 * Escape a Markdown link/image destination. URLs in the domain are already
 * normalized and safe; here we only handle Markdown syntax characters so
 * query strings and fragments are never altered.
 */
export function escapeMarkdownUrl(url: string): string {
  return url.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Escape a Markdown link/image title attribute. */
export function escapeMarkdownTitle(title: string): string {
  return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escape a table cell (pipes, newlines via <br>, plus inline specials). */
export function escapeMarkdownTableCell(text: string): string {
  return escapeMarkdownText(text).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
