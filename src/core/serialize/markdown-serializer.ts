/**
 * Core Markdown serializer: canonical Domain → source-faithful Markdown.
 *
 * Pure, deterministic, no side effects, no DOM, no Chrome, no React.
 * This is NOT agent context generation — Page2Agent instructions live in the
 * application layer and never appear in this output.
 */
import { assertNever } from "../validation/primitives";
import type { CodeBlock, ContentBlock, NormalizedDocument } from "../types/document";
import { escapeMarkdownTableCell, escapeMarkdownText, escapeMarkdownTitle, escapeMarkdownUrl } from "./markdown-escaping";

/** Task-list marker at the start of a list item (preserved verbatim). */
const TASK_LIST_MARKER = /^\[( |x|X)\]\s+/;

/** Choose the fenced-code fence length: max(3, longest backtick run + 1). */
export function chooseFenceLength(code: string): number {
  let longestRun = 0;
  let currentRun = 0;
  for (const character of code) {
    if (character === "`") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return Math.max(3, longestRun + 1);
}

const SAFE_LANGUAGE_PATTERN = /^[a-zA-Z0-9+#._-]+$/;

function isSafeLanguageHint(language: string | undefined): language is string {
  return language !== undefined && SAFE_LANGUAGE_PATTERN.test(language);
}

export function serializeContentBlocks(blocks: readonly ContentBlock[]): string {
  if (blocks.length === 0) {
    return "";
  }
  const sections = blocks.map(serializeBlock);
  return sections.join("\n\n") + "\n";
}

function serializeBlock(block: ContentBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${escapeMarkdownText(block.text)}`;
    case "paragraph":
      return escapeMarkdownText(block.text);
    case "code":
      return serializeCodeBlock(block);
    case "quote":
      return block.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "list":
      return block.items
        .map((item, index) => serializeListItem(item, block.ordered, index))
        .join("\n");
    case "image":
      return serializeImageBlock(block);
    case "link":
      return `[${escapeMarkdownText(block.text)}](${escapeMarkdownUrl(block.href)})`;
    case "table":
      return serializeTableBlock(block);
    default:
      return assertNever(block);
  }
}

function serializeCodeBlock(block: CodeBlock): string {
  const fence = "`".repeat(chooseFenceLength(block.code));
  const language = isSafeLanguageHint(block.language) ? block.language : undefined;
  const openingLine = language === undefined ? fence : `${fence}${language}`;
  // Code body is preserved verbatim; only structural newlines are added.
  return `${openingLine}\n${block.code}\n${fence}`;
}

function serializeListItem(item: string, ordered: boolean, index: number): string {
  const prefix = ordered ? `${index + 1}. ` : "- ";
  const markerMatch = TASK_LIST_MARKER.exec(item);
  if (markerMatch !== null) {
    // Preserve GitHub task-list markers verbatim ([x] / [ ]).
    const marker = markerMatch[0];
    return `${prefix}${marker}${escapeMarkdownText(item.slice(marker.length))}`;
  }
  return `${prefix}${escapeMarkdownText(item)}`;
}

function serializeImageBlock(block: Extract<ContentBlock, { type: "image" }>): string {
  const alt = escapeMarkdownText(block.alt ?? "");
  const destination = escapeMarkdownUrl(block.src);
  const title =
    block.title === undefined ? "" : ` "${escapeMarkdownTitle(block.title)}"`;
  return `![${alt}](${destination}${title})`;
}

function serializeTableBlock(block: Extract<ContentBlock, { type: "table" }>): string {
  const columnCount = block.rows[0].length;
  // Markdown tables require a header row. Without a source header, emit an
  // empty structural header — never invent "Column 1/2" source facts.
  const headers =
    block.headers ?? Array.from({ length: columnCount }, () => "");
  const lines: string[] = [];
  lines.push(`| ${headers.map(escapeMarkdownTableCell).join(" | ")} |`);
  lines.push(`| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`);
  for (const row of block.rows) {
    lines.push(`| ${row.map(escapeMarkdownTableCell).join(" | ")} |`);
  }
  return lines.join("\n");
}

export function serializeNormalizedDocument(document: NormalizedDocument): string {
  const metadataLines: string[] = [`Source: ${document.source.url}`];
  if (isWebLikeSource(document.source) && document.source.canonicalUrl !== undefined) {
    metadataLines.push(`Canonical URL: ${document.source.canonicalUrl}`);
  }
  if (document.metadata.author !== undefined) {
    metadataLines.push(`Author: ${escapeMarkdownText(document.metadata.author)}`);
  }
  if (document.metadata.publishedAt !== undefined) {
    metadataLines.push(`Published At: ${document.metadata.publishedAt}`);
  }
  metadataLines.push(`Captured At: ${document.metadata.capturedAt}`);

  const sections: string[] = [
    `# ${escapeMarkdownText(document.metadata.title)}`,
    metadataLines.join("\n"),
    serializeContentBlocks(document.blocks).replace(/\n+$/, ""),
  ];
  return sections.join("\n\n") + "\n";
}

function isWebLikeSource(
  source: NormalizedDocument["source"],
): source is Extract<NormalizedDocument["source"], { canonicalUrl?: string }> {
  return "canonicalUrl" in source;
}
