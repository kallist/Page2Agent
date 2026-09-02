/**
 * Shared site-neutral semantic DOM → ContentBlock normalization.
 *
 * Rules:
 * - Semantic elements (headings, p, pre, blockquote, ul/ol, table, img, a,
 *   figure) consume their own subtrees; the walker never re-enters them.
 * - Unknown containers recurse into children; text-only leaves fall back to a
 *   ParagraphBlock. Containers whose children are all inline elements are
 *   treated as text wrappers (paragraph fallback).
 * - Inline anchors: visible text is preserved inside the semantic block and
 *   safe links are appended as LinkBlocks right after it (deduplicated per
 *   container). Markdown is never produced.
 * - URL policy is delegated to core normalizeLinkUrl / normalizeAssetUrl.
 */
import { isTableBlock, normalizeAssetUrl, normalizeLinkUrl } from "../../core";
import type {
  ContentBlock,
  ImageBlock,
  LinkBlock,
  TableBlock,
} from "../../core";
import { extractCodeBlock } from "./code-block";
import { getNormalizedText, normalizeInlineText } from "./text";

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

const HEADING_LEVELS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
};

/** Tags inside a blockquote that force recursive extraction instead of a flat quote. */
const BLOCKQUOTE_COMPLEX_TAGS = new Set([
  "PRE",
  "UL",
  "OL",
  "TABLE",
  "BLOCKQUOTE",
  "FIGURE",
  "FORM",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/** Inline-level tags that do not represent standalone semantic blocks. */
const INLINE_TAGS = new Set([
  "A",
  "SPAN",
  "STRONG",
  "EM",
  "B",
  "I",
  "CODE",
  "BR",
  "SMALL",
  "SUB",
  "SUP",
  "MARK",
  "KBD",
  "SAMP",
  "VAR",
  "ABBR",
  "CITE",
  "DEL",
  "INS",
  "U",
  "TIME",
  "IMG",
  "WBR",
]);

const IMAGE_ATTRIBUTE_FALLBACKS = ["src", "data-src", "data-original"] as const;

/** Convert a semantic body subtree into blocks in reading order. */
export function domToBlocks(root: Element, sourceUrl: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of [...root.children]) {
    walk(child, blocks, sourceUrl);
  }
  return blocks;
}

function walk(node: Node, blocks: ContentBlock[], sourceUrl: string): void {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const element = node as Element;
  const tag = element.tagName;
  if (SKIPPED_TAGS.has(tag)) {
    return;
  }
  const headingLevel = HEADING_LEVELS[tag];
  if (headingLevel !== undefined) {
    pushHeading(element, headingLevel, blocks, sourceUrl);
    return;
  }
  switch (tag) {
    case "P":
      pushParagraph(element, blocks, sourceUrl);
      return;
    case "PRE":
      pushCode(element, blocks);
      return;
    case "BLOCKQUOTE":
      pushQuote(element, blocks, sourceUrl);
      return;
    case "UL":
    case "OL":
      pushList(element, blocks, sourceUrl);
      return;
    case "TABLE":
      pushTable(element, blocks, sourceUrl);
      return;
    case "IMG":
      pushImage(element, blocks, sourceUrl);
      return;
    case "A":
      pushStandaloneLink(element, blocks, sourceUrl);
      return;
    case "FIGURE":
      pushFigure(element, blocks, sourceUrl);
      return;
    case "HR":
      return;
    default:
      walkContainer(element, blocks, sourceUrl);
  }
}

function walkContainer(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  const children = [...element.children];
  if (children.length === 0) {
    const text = getNormalizedText(element);
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    return;
  }
  if (children.every((child) => INLINE_TAGS.has(child.tagName))) {
    // Text wrapper (e.g. <div> with inline content): paragraph fallback.
    const text = getNormalizedText(element);
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    for (const child of children) {
      if (child.tagName === "IMG") {
        walk(child, blocks, sourceUrl);
      }
    }
    appendReferenceLinks(element, blocks, sourceUrl);
    return;
  }
  for (const child of children) {
    walk(child, blocks, sourceUrl);
  }
}

function pushHeading(
  element: Element,
  level: 1 | 2 | 3 | 4 | 5 | 6,
  blocks: ContentBlock[],
  sourceUrl: string,
): void {
  const text = getNormalizedText(element);
  if (!text) {
    return;
  }
  blocks.push({ type: "heading", level, text });
  appendReferenceLinks(element, blocks, sourceUrl);
}

function pushParagraph(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  const text = getNormalizedText(element);
  if (text) {
    blocks.push({ type: "paragraph", text });
  }
  // Inline images inside a paragraph are still content references.
  for (const child of element.children) {
    if (child.tagName === "IMG") {
      walk(child, blocks, sourceUrl);
    }
  }
  appendReferenceLinks(element, blocks, sourceUrl);
}

function pushCode(element: Element, blocks: ContentBlock[]): void {
  const codeBlock = extractCodeBlock(element);
  if (codeBlock !== null) {
    blocks.push(codeBlock);
  }
}

function pushQuote(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  const hasComplexChildren = [...element.children].some((child) =>
    BLOCKQUOTE_COMPLEX_TAGS.has(child.tagName),
  );
  if (hasComplexChildren) {
    for (const child of element.children) {
      walk(child, blocks, sourceUrl);
    }
    return;
  }
  const text = getNormalizedText(element);
  if (text) {
    blocks.push({ type: "quote", text });
  }
  appendReferenceLinks(element, blocks, sourceUrl);
}

function pushList(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  const ordered = element.tagName === "OL";
  const items: string[] = [];
  for (const child of element.children) {
    if (child.tagName !== "LI") {
      continue;
    }
    // Nested list markup is flattened into the parent item text (V0.1 flat model).
    const text = getNormalizedText(child);
    if (text) {
      items.push(text);
    }
  }
  if (items.length === 0) {
    return;
  }
  blocks.push({ type: "list", ordered, items });
  appendReferenceLinks(element, blocks, sourceUrl);
}

function pushImage(element: Element, blocks: ContentBlock[], sourceUrl: string): ImageBlock | null {
  const src = resolveImageSource(element, sourceUrl);
  if (src === null) {
    return null;
  }
  const image: ImageBlock = { type: "image", src };
  const alt = normalizeInlineText(element.getAttribute("alt") ?? "");
  const title = normalizeInlineText(element.getAttribute("title") ?? "");
  if (alt) {
    image.alt = alt;
  }
  if (title) {
    image.title = title;
  }
  blocks.push(image);
  return image;
}

function resolveImageSource(element: Element, sourceUrl: string): string | null {
  for (const attribute of IMAGE_ATTRIBUTE_FALLBACKS) {
    const raw = element.getAttribute(attribute);
    if (raw === null) {
      continue;
    }
    const normalized = normalizeAssetUrl(raw, sourceUrl);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function pushStandaloneLink(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  const href = normalizeLinkUrl(element.getAttribute("href") ?? "", sourceUrl);
  if (href === null) {
    return;
  }
  const text = getNormalizedText(element);
  if (!text) {
    return;
  }
  blocks.push({ type: "link", href, text });
}

function pushFigure(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  let lastImageAlt: string | undefined;
  for (const child of element.children) {
    const tag = child.tagName;
    if (tag === "IMG") {
      const image = pushImage(child, blocks, sourceUrl);
      if (image !== null) {
        lastImageAlt = image.alt;
      }
    } else if (tag === "FIGCAPTION") {
      const text = getNormalizedText(child);
      // Avoid duplicating a caption that exactly repeats the image alt.
      if (text && text !== lastImageAlt) {
        blocks.push({ type: "paragraph", text });
      }
    } else {
      walk(child, blocks, sourceUrl);
    }
  }
}

function pushTable(element: Element, blocks: ContentBlock[], sourceUrl: string): void {
  const rows: { cells: string[]; isHeader: boolean }[] = [];
  for (const row of element.querySelectorAll("tr")) {
    const cells = [...row.querySelectorAll("th, td")];
    rows.push({
      cells: cells.map((cell) => getNormalizedText(cell)),
      isHeader: cells.length > 0 && cells.every((cell) => cell.tagName === "TH"),
    });
  }
  if (rows.length === 0) {
    return;
  }

  let headers: string[] | undefined;
  let bodyRows: string[][];
  if (rows[0].isHeader) {
    headers = rows[0].cells;
    bodyRows = rows.slice(1).map((row) => row.cells);
  } else {
    bodyRows = rows.map((row) => row.cells);
  }

  const columnCount = headers?.length ?? bodyRows[0]?.length ?? 0;
  const consistent =
    bodyRows.length > 0 && bodyRows.every((row) => row.length === columnCount);

  if (!consistent) {
    // Ragged or empty tables: preserve visible text, skip the table block.
    fallbackTableToText(element, blocks, sourceUrl);
    return;
  }

  const table: TableBlock = { type: "table", rows: bodyRows };
  if (headers !== undefined) {
    table.headers = headers;
  }
  if (!isTableBlock(table)) {
    fallbackTableToText(element, blocks, sourceUrl);
    return;
  }
  blocks.push(table);
  appendReferenceLinks(element, blocks, sourceUrl);
}

function fallbackTableToText(
  element: Element,
  blocks: ContentBlock[],
  sourceUrl: string,
): void {
  // Preserve visible table content with cell separation (rows joined by
  // spaces) instead of a raw textContent concatenation.
  const rowTexts = [...element.querySelectorAll("tr")]
    .map((row) => getNormalizedText(row))
    .filter((text) => text.length > 0);
  if (rowTexts.length > 0) {
    blocks.push({ type: "paragraph", text: rowTexts.join(" ") });
  }
  appendReferenceLinks(element, blocks, sourceUrl);
}

/**
 * Appends deduplicated LinkBlocks (by href) for safe anchors inside a
 * container, in DOM order. Visible anchor text is already preserved in the
 * semantic text block itself; unsafe hrefs never become LinkBlocks.
 */
function appendReferenceLinks(
  element: Element,
  blocks: ContentBlock[],
  sourceUrl: string,
): void {
  const seen = new Set<string>();
  for (const anchor of element.querySelectorAll("a[href]")) {
    const href = normalizeLinkUrl(anchor.getAttribute("href") ?? "", sourceUrl);
    if (href === null || seen.has(href)) {
      continue;
    }
    const text = getNormalizedText(anchor);
    if (!text) {
      continue;
    }
    seen.add(href);
    const link: LinkBlock = { type: "link", href, text };
    blocks.push(link);
  }
}
