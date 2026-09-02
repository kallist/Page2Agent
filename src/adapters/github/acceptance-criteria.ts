/**
 * Source Acceptance Criteria extraction — operates on the NORMALIZED source
 * blocks, never on the DOM, so TASK 06 can build AgentTasks from a
 * NormalizedDocument alone.
 *
 * Semantics (source truth boundary):
 * - No explicit AC heading in the source → null ("not provided in source").
 * - Explicit AC section → criteria in source order, exact-wording preserved.
 * - Only ListBlock items and ParagraphBlock texts become criteria.
 * - This module never generates engineering instructions; it never mutates.
 */
import type { ContentBlock } from "../../core";

const AC_HEADING_VOCABULARY = new Set([
  "acceptance criteria",
  "acceptance",
  "requirements",
  "definition of done",
]);

function normalizeHeadingText(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/:$/, "").toLowerCase();
}

export function isAcceptanceCriteriaHeading(text: string): boolean {
  return AC_HEADING_VOCABULARY.has(normalizeHeadingText(text));
}

/**
 * Collect explicit source acceptance criteria from normalized blocks.
 * Returns null when no criteria are explicitly present (empty AC sections
 * are also null — an empty array is not a valid representation).
 */
export function extractSourceAcceptanceCriteria(
  blocks: readonly ContentBlock[],
): string[] | null {
  const criteria: string[] = [];
  const seen = new Set<string>();
  let sectionActive = false;
  let sectionLevel = 0;

  for (const block of blocks) {
    if (block.type === "heading") {
      if (isAcceptanceCriteriaHeading(block.text)) {
        sectionActive = true;
        sectionLevel = block.level;
        continue;
      }
      if (sectionActive && block.level <= sectionLevel) {
        sectionActive = false;
      }
      continue;
    }
    if (!sectionActive) {
      continue;
    }
    if (block.type === "list") {
      for (const item of block.items) {
        if (!seen.has(item)) {
          seen.add(item);
          criteria.push(item);
        }
      }
    } else if (block.type === "paragraph") {
      if (!seen.has(block.text)) {
        seen.add(block.text);
        criteria.push(block.text);
      }
    }
    // Code, quote, table, image and link blocks are never criteria.
  }

  return criteria.length > 0 ? criteria : null;
}
