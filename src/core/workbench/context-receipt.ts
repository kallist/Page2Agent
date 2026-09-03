/**
 * Context Receipt + Context Nutrition Label derivation (V1.1).
 *
 * What exactly will the Agent receive? The receipt answers that with
 * OBSERVABLE structure — never with invented quality scores:
 *
 * - `included` labels come from the captured document itself (title, body,
 *   headings present in the blocks, labels when present);
 * - `excluded` labels are mechanism facts: each semantic adapter only
 *   extracts its known content region, so page chrome that never entered the
 *   document is listed as excluded by design;
 * - `generated` / `unknowns` come from the Recipe + TaskSpec builder;
 * - nutrition percentages are computed from deterministic token estimates
 *   and always labeled estimated.
 */
import type { ContentBlock, NormalizedDocument } from "../types/document";
import { estimateDocumentTokens, TOKEN_ESTIMATE_METHOD } from "./token-estimate";
import type { RecipeId } from "./recipes";
import type { TaskSpec } from "./task-spec";

export const RECEIPT_INCLUDED_CATEGORIES = [
  "Page Title",
  "Issue Title",
  "Issue Body",
  "PR Title",
  "PR Description",
  "Labels",
  "Author",
  "Published At",
] as const;

export interface ReceiptSourceRow {
  id: string;
  title: string;
  /** Semantic adapter that normalized this source (may be absent on legacy). */
  adapter?: { id: string; name: string };
  /** capture scope, UI-mapped later: full page / selected sections / text. */
  scope: "full-page" | "selection" | "text-selection";
  /** Observable document parts actually included. */
  included: string[];
  /** Mechanism-level parts never captured by this source's pipeline. */
  excluded: string[];
  /** Selected region labels when the source is a pick. */
  selectedLabels: string[];
}

export interface ContextReceipt {
  sources: ReceiptSourceRow[];
  generated: string[];
  unknowns: string[];
  warnings: string[];
  /** Estimated content tokens across all receipt sources. */
  tokenEstimate: { tokens: number; method: typeof TOKEN_ESTIMATE_METHOD };
}

/** Deterministic exclusion categories per semantic adapter (mechanism facts). */
const GITHUB_ISSUE_EXCLUDED: readonly string[] = [
  "Navigation",
  "Comments and comment threads",
  "GitHub UI (sidebars, headers, profile chrome)",
  "Drag/drop and accessibility helper UI",
];

const GITHUB_PR_EXCLUDED: readonly string[] = [
  "Navigation",
  "Review comments and threads",
  "GitHub UI (sidebars, headers, profile chrome)",
  "Diff browsing chrome",
];

const GENERIC_EXCLUDED: readonly string[] = [
  "Navigation",
  "Page chrome, sidebars and related-link widgets",
  "Scripts, styles and embedded widgets",
];

const TECHNICAL_DOCS_EXCLUDED: readonly string[] = [
  "Navigation (site menu and table-of-contents chrome)",
  "Page chrome, sidebars and related-link widgets",
  "Scripts, styles and embedded widgets",
];

const ADAPTER_EXCLUDED: Readonly<Record<string, readonly string[]>> = {
  "generic-article": GENERIC_EXCLUDED,
  "github-issue": GITHUB_ISSUE_EXCLUDED,
  "github-pull-request": GITHUB_PR_EXCLUDED,
  "technical-docs": TECHNICAL_DOCS_EXCLUDED,
  "context-lens": GENERIC_EXCLUDED,
};

export interface ReceiptSourceInput {
  id: string;
  title: string;
  adapter?: { id: string; name: string };
  scope: "full-page" | "selection" | "text-selection";
  selectedLabels: string[];
  document: NormalizedDocument;
}

export interface BuildReceiptInput {
  sources: ReceiptSourceInput[];
  recipe?: RecipeId;
  task?: { kind: TaskSpec["task"]["kind"] };
  unknowns?: string[];
  warnings?: string[];
}

export function buildContextReceipt(input: BuildReceiptInput): ContextReceipt {
  const rows: ReceiptSourceRow[] = input.sources.map((source) => ({
    id: source.id,
    title: source.title,
    ...(source.adapter !== undefined ? { adapter: { ...source.adapter } } : {}),
    scope: source.scope,
    included: deriveIncludedLabels(source),
    excluded: deriveExcludedLabels(source),
    selectedLabels: [...source.selectedLabels],
  }));
  const generated: string[] = [];
  if (input.recipe !== undefined) {
    generated.push(`Recipe: ${input.recipe}`);
  }
  if (input.task !== undefined) {
    generated.push(`Task kind: ${input.task.kind}`);
  }
  if (input.recipe !== undefined || input.task !== undefined) {
    generated.push("Agent instructions");
  }
  const contentTokens = input.sources.reduce(
    (sum, source) => sum + estimateDocumentTokens(source.document),
    0,
  );
  return {
    sources: rows,
    generated,
    unknowns: [...(input.unknowns ?? [])],
    warnings: [...(input.warnings ?? [])],
    tokenEstimate: { tokens: contentTokens, method: TOKEN_ESTIMATE_METHOD },
  };
}

function deriveIncludedLabels(source: ReceiptSourceInput): string[] {
  const { document } = source;
  const labels: string[] = [];
  const kind = document.source.kind;
  const scopeLabel = (() => {
    switch (source.scope) {
      case "selection":
        return "Selected Sections";
      case "text-selection":
        return "Text Selection";
      default:
        return undefined;
    }
  })();

  if (kind === "github_issue") {
    labels.push("Issue Title");
    labels.push("Issue Body");
  } else if (kind === "github_pull_request") {
    labels.push("PR Title");
    labels.push("PR Description");
  } else {
    labels.push("Page Title");
    labels.push("Page Content");
  }
  if (scopeLabel !== undefined) {
    labels.push(scopeLabel);
    for (const label of source.selectedLabels) {
      if (!labels.includes(label)) {
        labels.push(label);
      }
    }
  }
  if (document.metadata.author !== undefined) {
    labels.push("Author");
  }
  if (document.metadata.publishedAt !== undefined) {
    labels.push("Published At");
  }
  if (kind === "github_issue" || kind === "github_pull_request") {
    if (document.source.labels !== undefined && document.source.labels.length > 0) {
      labels.push("Labels");
    }
  }
  // Content subsections come straight from the normalized headings — the
  // strongest evidence of what is really inside the capture. A heading is a
  // labeled subsection when it comes after the first heading or is nested
  // deeper than it (deterministic, bounded to keep the receipt readable).
  const first = firstHeading(document.blocks);
  if (first !== undefined) {
    let subsectionCount = 0;
    for (let index = 0; index < document.blocks.length; index += 1) {
      const block = document.blocks[index];
      if (block.type !== "heading") {
        continue;
      }
      if (index > first.index || block.level > first.level) {
        labels.push(block.text);
        subsectionCount += 1;
        if (subsectionCount >= 20) {
          break;
        }
      }
    }
  }
  return dedupeLabels(labels);
}

interface HeadingAnchor {
  index: number;
  level: number;
}

function firstHeading(blocks: readonly ContentBlock[]): HeadingAnchor | undefined {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type === "heading") {
      return { index, level: block.level };
    }
  }
  return undefined;
}

function deriveExcludedLabels(source: ReceiptSourceInput): string[] {
  const adapterId = source.adapter?.id;
  return [...new Set(adapterId !== undefined ? (ADAPTER_EXCLUDED[adapterId] ?? GENERIC_EXCLUDED) : [])];
}

function dedupeLabels(labels: string[]): string[] {
  return [...new Set(labels)];
}

// ---------------------------------------------------------------------------
// Nutrition facts (context nutrition label)
// ---------------------------------------------------------------------------

export interface ContextNutritionFacts {
  estimatedTokens: number;
  /** Deterministic integer percentages (rounded) of estimated tokens. */
  sourceContentPercent: number;
  generatedPercent: number;
  metadataPercent: number;
  counts: {
    sources: number;
    codeBlocks: number;
    tables: number;
    links: number;
    headings: number;
  };
  explicitAcceptanceCriteria: boolean | null;
  provenanceComplete: boolean;
  status: "clean" | "has-unknowns" | "has-warnings";
}

export interface BuildNutritionInput {
  spec: TaskSpec;
  unknowns: string[];
  warnings: string[];
}

export function buildContextNutritionFacts(input: BuildNutritionInput): ContextNutritionFacts {
  const { spec } = input;
  const total = spec.estimates.totalEstimatedTokens;
  const percent = (value: number): number =>
    total <= 0 ? 0 : Math.round((value / total) * 100);

  let codeBlocks = 0;
  let tables = 0;
  let links = 0;
  for (const source of spec.sources) {
    codeBlocks += source.stats.codeBlocks;
    tables += source.stats.tables;
    links += source.stats.links;
  }
  const explicitAcceptanceCriteria =
    spec.recipe === "fix" ? spec.requirements.acceptanceCriteria !== null : null;
  const provenanceComplete = spec.sources.every(
    (source) => source.provenance.captureId.length > 0 && source.url.length > 0,
  );
  const status =
    input.warnings.length > 0
      ? "has-warnings"
      : input.unknowns.length > 0 || (explicitAcceptanceCriteria === false && spec.recipe === "fix")
        ? "has-unknowns"
        : "clean";

  return {
    estimatedTokens: total,
    sourceContentPercent: percent(spec.estimates.sourceContentTokens),
    generatedPercent: percent(spec.estimates.generatedTokens),
    metadataPercent: percent(spec.estimates.metadataTokens),
    counts: { sources: spec.sources.length, codeBlocks, tables, links, headings: countHeadings(spec) },
    explicitAcceptanceCriteria,
    provenanceComplete,
    status,
  };
}

function countHeadings(spec: TaskSpec): number {
  // TaskSpec sources carry markdown content; count heading lines deterministically.
  let count = 0;
  for (const source of spec.sources) {
    for (const line of source.contentMarkdown.split("\n")) {
      if (/^#{1,6}\s+\S/.test(line)) {
        count += 1;
      }
    }
  }
  return count;
}
