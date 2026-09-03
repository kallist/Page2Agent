/**
 * Page2Agent estimated token counting (V1.1).
 *
 * Deterministic, fast, offline, provider-neutral approximation — it is NOT a
 * GPT/Claude/Gemini tokenizer. Everywhere these numbers are shown they must be
 * labeled "estimated tokens"; this module never implies exactness.
 *
 * Heuristic (documented in ADR-002):
 * - one code point in CJK / Hangul / Kana / full-width ranges counts as 1 token;
 * - every other code point counts 1/4 token;
 * - the block/field traversal mirrors size-policy so estimates and the size
 *   limit speak about the same payload (metadata like URLs/timestamps is
 *   counted separately for nutrition reporting).
 */
import type { ContentBlock, NormalizedDocument } from "../types/document";

/** Stable method identifier carried in TaskSpec / receipts. */
export const TOKEN_ESTIMATE_METHOD = "page2agent-heuristic-v1";

/** CJK ideographs, kana, hangul, full-width forms, CJK punctuation. */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK radicals..CJK unified
    (codePoint >= 0x3000 && codePoint <= 0x30ff) || // CJK punctuation + kana
    (codePoint >= 0xac00 && codePoint <= 0xd7af) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compat ideographs
    (codePoint >= 0xff00 && codePoint <= 0xff60) // full-width forms
  );
}

/** Estimated tokens for one text string (never negative; empty text → 0). */
export function estimateTextTokens(text: string): number {
  let wide = 0;
  let narrow = 0;
  for (const codePoint of text) {
    if (isWideCodePoint(codePoint.codePointAt(0) ?? 0)) {
      wide += 1;
    } else {
      narrow += 1;
    }
  }
  return Math.ceil(wide + narrow / 4);
}

export interface EstimatedTokens {
  /** Estimated token count. */
  tokens: number;
  /** Always the documented heuristic; consumers label it "estimated". */
  method: typeof TOKEN_ESTIMATE_METHOD;
}

/** Text payload → estimated tokens with the method label. */
export function estimateTokens(text: string): EstimatedTokens {
  return { tokens: estimateTextTokens(text), method: TOKEN_ESTIMATE_METHOD };
}

/**
 * Estimated tokens for one ContentBlock. Field traversal intentionally
 * mirrors countContentBlockCharacters (size-policy) so both talk about the
 * same content payload.
 */
export function estimateContentBlockTokens(block: ContentBlock): number {
  switch (block.type) {
    case "heading":
      return estimateTextTokens(block.text);
    case "paragraph":
      return estimateTextTokens(block.text);
    case "code":
      return estimateTextTokens(block.code);
    case "quote":
      return estimateTextTokens(block.text);
    case "list":
      return estimateTextTokens(block.items.join("\n"));
    case "image":
      return estimateTextTokens(`${block.alt ?? ""} ${block.title ?? ""}`);
    case "link":
      return estimateTextTokens(`${block.href} ${block.text}`);
    case "table": {
      const rows = block.rows.map((row) => row.join("\t"));
      const headers = block.headers !== undefined ? [block.headers.join("\t")] : [];
      return estimateTextTokens([...headers, ...rows].join("\n"));
    }
    default:
      return 0;
  }
}

export function estimateBlocksTokens(blocks: readonly ContentBlock[]): number {
  return blocks.reduce((sum, block) => sum + estimateContentBlockTokens(block), 0);
}

/** Estimated content tokens of a full captured document (blocks only). */
export function estimateDocumentTokens(document: NormalizedDocument): number {
  return estimateBlocksTokens(document.blocks);
}

/** Metadata payload estimate — titles, URLs, author, timestamps (small). */
export function estimateMetadataTokens(document: NormalizedDocument): number {
  const parts: string[] = [document.metadata.title];
  const { source } = document;
  parts.push(source.url);
  if (source.kind === "github_issue") {
    parts.push(`${source.owner}/${source.repo} #${source.issueNumber}`);
  } else if (source.kind === "github_pull_request") {
    parts.push(`${source.owner}/${source.repo} #${source.prNumber}`);
  }
  if ("canonicalUrl" in source && source.canonicalUrl !== undefined) {
    parts.push(source.canonicalUrl);
  }
  if (source.kind !== "web" && source.labels !== undefined) {
    parts.push(source.labels.join(" "));
  }
  if (document.metadata.author !== undefined) {
    parts.push(document.metadata.author);
  }
  if (document.metadata.publishedAt !== undefined) {
    parts.push(document.metadata.publishedAt);
  }
  parts.push(document.metadata.capturedAt);
  return estimateTextTokens(parts.join("\n"));
}

/** Small guard: refuse absurd estimates that would overflow display math. */
export const MAX_ESTIMATED_TOKENS = 2_000_000;
