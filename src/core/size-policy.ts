/**
 * Content size policy. Silent truncation is FORBIDDEN: documents over the hard
 * limit must be rejected with CONTENT_TOO_LARGE at the extraction boundary.
 * This module only counts; it never truncates.
 */
import { assertNever } from "./validation/primitives";
import type { ContentBlock, NormalizedDocument } from "./types/document";

/** Hard safety limit on extracted textual content, in characters. */
export const MAX_DOCUMENT_CHARACTERS = 500_000;

/**
 * Counts the textual payload of one block. Metadata (URLs, titles, timestamps)
 * is intentionally NOT counted so it cannot dominate the content limit.
 * Image alt/title are counted as content references (non-core).
 */
export function countContentBlockCharacters(block: ContentBlock): number {
  switch (block.type) {
    case "heading":
      return block.text.length;
    case "paragraph":
      return block.text.length;
    case "code":
      return block.code.length;
    case "quote":
      return block.text.length;
    case "list":
      return block.items.reduce((sum, item) => sum + item.length, 0);
    case "image":
      return (block.alt?.length ?? 0) + (block.title?.length ?? 0);
    case "link":
      return block.href.length + block.text.length;
    case "table": {
      let total = 0;
      for (const row of block.rows) {
        for (const cell of row) {
          total += cell.length;
        }
      }
      if (block.headers !== undefined) {
        for (const header of block.headers) {
          total += header.length;
        }
      }
      return total;
    }
    default:
      return assertNever(block);
  }
}

export function countDocumentCharacters(document: NormalizedDocument): number {
  return document.blocks.reduce(
    (sum, block) => sum + countContentBlockCharacters(block),
    0,
  );
}

export function isWithinDocumentLimit(document: NormalizedDocument): boolean {
  return countDocumentCharacters(document) <= MAX_DOCUMENT_CHARACTERS;
}
