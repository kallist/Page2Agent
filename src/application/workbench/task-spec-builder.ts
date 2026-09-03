/**
 * TaskSpec builder — application layer (V1.1).
 *
 * ContextCart items + one Recipe → validated TaskSpec.
 *
 * Source truth rules enforced here:
 * - acceptance criteria come ONLY from explicit source sections via the
 *   shared extractor; null when the source did not provide them;
 * - `unknowns` state what is NOT in the sources instead of inventing it;
 * - task kind/title/instructions/target/estimates are generated fields and
 *   live in generated containers, never blended with source content;
 * - output is deterministic: cart order, fixed key order, fixed vocabulary.
 */
import {
  countDocumentCharacters,
  estimateBlocksTokens,
  estimateMetadataTokens,
  estimateTextTokens,
  gateRecipe,
  getRecipeDefinition,
  isTaskSpec,
  Page2AgentError,
  Page2AgentErrorCode,
  primaryContextSource,
  RECIPE_TRUST_BOUNDARY_INSTRUCTIONS,
  taskKindForRecipe,
  TOKEN_ESTIMATE_METHOD,
  TASK_SPEC_PRODUCER,
  TASK_SPEC_SCHEMA_VERSION,
} from "../../core";
import type {
  ContextCart,
  ContextSourceItem,
  RecipeId,
  TaskSpec,
  TaskSpecSource,
  TaskSpecSourceScope,
} from "../../core";
import { extractSourceAcceptanceCriteria } from "../../adapters/github/acceptance-criteria";
import { serializeContentBlocks } from "../../core/serialize";

export const ACCEPTANCE_CRITERIA_UNKNOWN_MESSAGE =
  "Explicit acceptance criteria not provided in the source.";

export type BuildTaskSpecResult =
  | { status: "ok"; spec: TaskSpec; recipe: RecipeId }
  | {
      status: "insufficient-sources";
      recipe: RecipeId;
      required: number;
      actual: number;
    };

const SOURCE_KIND_TO_TYPE: Record<ContextSourceItem["sourceKind"], TaskSpecSource["type"]> = {
  web: "web",
  github_issue: "github_issue",
  github_pull_request: "github_pull_request",
};

const ITEM_SCOPE_TO_TASK_SCOPE: Record<
  ContextSourceItem["scope"],
  TaskSpecSourceScope
> = {
  "full-page": "full_page",
  selection: "selected_sections",
  "text-selection": "text_selection",
};

/** Deterministic unknown-text for selected-section sources without labels. */
const TITLE_LENGTH_LIMIT = 400;

export function buildTaskSpec(cart: ContextCart, recipe: RecipeId): BuildTaskSpecResult {
  const gate = gateRecipe(recipe, cart.items.length);
  if (gate.status !== "ok") {
    return gate;
  }
  if (!isTaskSpecBuildable(cart)) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "TaskSpec construction received an invalid Context Cart.",
    });
  }

  const items = cart.items;
  const primary = primaryContextSource(cart);
  const primaryId = primary?.id ?? null;
  // Multi-issue carts: the TASK-shaped issue (role task or primary) leads AC
  // extraction; any other issue is evidence/reference and stays out of the
  // single requirements object (per-source AC modeling is out of scope).
  const issueSource =
    items.find((item) => item.sourceKind === "github_issue" && isTaskShaped(item)) ??
    items.find((item) => item.sourceKind === "github_issue") ??
    undefined;
  const kind = taskKindForRecipe(recipe, issueSource !== undefined);

  const sources: TaskSpecSource[] = items.map((item) => buildSource(item, item.id === primaryId));
  const sourceTokenTotal = sources.reduce(
    (sum, source) => sum + source.tokenEstimate.tokens,
    0,
  );

  const acceptanceCriteria =
    issueSource !== undefined && (kind === "fix_issue" || kind === "fix")
      ? extractSourceAcceptanceCriteria(issueSource.document.blocks)
      : null;

  const unknowns: string[] = [];
  if (kind === "fix_issue" && acceptanceCriteria === null) {
    unknowns.push(ACCEPTANCE_CRITERIA_UNKNOWN_MESSAGE);
  }

  const definition = getRecipeDefinition(recipe);
  const instructions = [
    ...RECIPE_TRUST_BOUNDARY_INSTRUCTIONS,
    ...definition.instructions,
  ];
  const generatedText = [definition.summary, ...instructions].join("\n");
  const metadataTokens = items.reduce(
    (sum, item) => sum + estimateMetadataTokens(item.document),
    0,
  );

  const spec: TaskSpec = {
    schemaVersion: TASK_SPEC_SCHEMA_VERSION,
    producer: { name: TASK_SPEC_PRODUCER.name, version: TASK_SPEC_PRODUCER.version },
    recipe,
    task: {
      kind,
      title: buildTaskTitle(recipe, primary, items.length),
    },
    target: { repository: resolveTargetRepository(items) },
    sources,
    requirements: { acceptanceCriteria },
    unknowns,
    generated: { instructions },
    estimates: {
      sourceContentTokens: sourceTokenTotal,
      generatedTokens: estimateTextTokens(generatedText),
      metadataTokens,
      totalEstimatedTokens:
        sourceTokenTotal + estimateTextTokens(generatedText) + metadataTokens,
    },
  };

  if (!isTaskSpec(spec)) {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "TaskSpec construction produced an invalid specification.",
    });
  }
  return { status: "ok", spec, recipe };
}

function isTaskSpecBuildable(cart: ContextCart): boolean {
  return cart.items.length > 0 && cart.items.every((item) => item.document.blocks.length > 0);
}

function isTaskShaped(item: ContextSourceItem): boolean {
  return item.role === "task" || item.primary;
}

function buildSource(item: ContextSourceItem, isPrimary: boolean): TaskSpecSource {
  const document = item.document;
  const source: TaskSpecSource = {
    id: item.id,
    type: SOURCE_KIND_TO_TYPE[item.sourceKind],
    url: item.url,
    title: item.title.slice(0, TITLE_LENGTH_LIMIT),
    role: item.role,
    isPrimary,
    scope: ITEM_SCOPE_TO_TASK_SCOPE[item.scope],
    capturedAt: item.capturedAt,
    provenance: { captureId: item.captureId },
    contentMarkdown: serializeContentBlocks(document.blocks),
    stats: {
      characters: countDocumentCharacters(document),
      codeBlocks: document.blocks.filter((block) => block.type === "code").length,
      tables: document.blocks.filter((block) => block.type === "table").length,
      links: document.blocks.filter((block) => block.type === "link").length,
    },
    tokenEstimate: {
      tokens: estimateBlocksTokens(document.blocks),
      method: TOKEN_ESTIMATE_METHOD,
    },
  };
  if (item.adapter !== undefined) {
    source.adapter = { id: item.adapter.id, name: item.adapter.name };
  }
  if (item.scope !== "full-page" && item.selection !== undefined) {
    source.selection = {
      regions: item.selection.regions,
      labels: [...item.selection.labels],
    };
  }
  return source;
}

function buildTaskTitle(
  recipe: RecipeId,
  primary: ContextSourceItem | undefined,
  sourceCount: number,
): string {
  if (recipe === "compare") {
    return `Compare ${sourceCount} captured sources`;
  }
  const title = primary?.title ?? "Untitled task material";
  return title.slice(0, TITLE_LENGTH_LIMIT);
}

/**
 * Target repository is emitted only when it is explicit: the primary source
 * is a GitHub issue/PR, or exactly one distinct repository appears in the
 * whole cart. Ambiguity stays null (never a guess).
 */
function resolveTargetRepository(items: readonly ContextSourceItem[]): string | null {
  const primary = items.find((item) => item.primary) ?? items[0];
  if (primary !== undefined && isGitHubSource(primary)) {
    return githubRepository(primary);
  }
  const repositories = new Set(items.filter(isGitHubSource).map(githubRepository));
  if (repositories.size === 1) {
    return [...repositories][0];
  }
  return null;
}

function isGitHubSource(item: ContextSourceItem): boolean {
  return item.sourceKind === "github_issue" || item.sourceKind === "github_pull_request";
}

function githubRepository(item: ContextSourceItem): string {
  const { source } = item.document;
  if (source.kind === "web") {
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "Target repository requested for a non-GitHub source.",
    });
  }
  return `${source.owner}/${source.repo}`;
}
