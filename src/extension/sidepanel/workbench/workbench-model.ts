/**
 * Side Panel workbench view model (V1.1) — pure orchestration, no chrome, no
 * React.
 *
 * One source of truth for what the panel can do with the CURRENT capture and
 * the Context Cart:
 * - a captured page becomes a candidate ContextSource (role/primary via the
 *   cart suggestions, exactly as if the user added it);
 * - the build basis is the Cart when it is non-empty, otherwise the latest
 *   capture candidate (the pre-cart "single page" experience);
 * - one function derives recipe gating, TaskSpec, delivery strings, the
 *   Context Receipt and the nutrition facts for the current basis.
 */
import {
  addContextSource,
  createEmptyCart,
  getRecipeDefinition,
  primaryContextSource,
  suggestInitialPrimary,
  suggestInitialRole,
  suggestRecipes,
} from "../../../core";
import type {
  ContextCart,
  ContextSourceItem,
  NormalizedDocument,
  RecipeId,
} from "../../../core";
import { buildContextNutritionFacts, buildContextReceipt } from "../../../core";
import type { ContextNutritionFacts, ContextReceipt } from "../../../core";
import { buildTaskSpec } from "../../../application/workbench/task-spec-builder";
import type { BuildTaskSpecResult } from "../../../application/workbench/task-spec-builder";
import { serializeAgentContext, serializeSourcesMarkdown } from "../../../application/workbench/delivery";
import { serializeTaskSpecJson } from "../../../application/workbench/task-spec-json";

export interface CaptureCandidateMeta {
  captureId: string;
  url: string;
  title: string;
  capturedAt: string;
}

function candidateItemFromDocument(
  document: NormalizedDocument,
  meta: CaptureCandidateMeta,
): ContextSourceItem {
  return {
    id: `captured-${meta.captureId}`,
    captureId: meta.captureId,
    url: meta.url,
    capturedAt: meta.capturedAt,
    title: meta.title || document.metadata.title,
    sourceKind: document.source.kind,
    adapter: document.capture?.adapter,
    scope: document.capture?.scope ?? "full-page",
    role: "reference",
    primary: false,
    document,
  };
}

/** Build the candidate item a fresh capture would become (task/primary). */
export function createCandidateContextItem(
  document: NormalizedDocument,
  meta: CaptureCandidateMeta,
): ContextSourceItem {
  const base = candidateItemFromDocument(document, meta);
  const empty = createEmptyCart();
  return { ...base, role: suggestInitialRole(base, empty), primary: suggestInitialPrimary(base, empty) };
}

export interface WorkbenchBasis {
  /** Sources used for building right now (cart, or the capture candidate). */
  items: ContextSourceItem[];
  /** True when the basis falls back to the capture candidate. */
  usingCaptureOnly: boolean;
}

export function resolveWorkbenchBasis(
  cart: ContextCart,
  candidate: ContextSourceItem | null,
): WorkbenchBasis {
  if (cart.items.length > 0) {
    return { items: cart.items, usingCaptureOnly: false };
  }
  if (candidate !== null) {
    const added = addContextSource(createEmptyCart(), candidate);
    if (added.status === "added") {
      return { items: added.cart.items, usingCaptureOnly: true };
    }
  }
  return { items: [], usingCaptureOnly: false };
}

export interface WorkbenchRecipeState {
  /** Current user selection when one exists. */
  selected: RecipeId | null;
  /** Recommended first suggestion for the basis (user stays in control). */
  recommended: RecipeId | undefined;
  /** Effective recipe used for building (selection or recommendation). */
  effective: RecipeId | undefined;
}

export function resolveRecipeState(
  basisItems: readonly ContextSourceItem[],
  selected: RecipeId | null,
): WorkbenchRecipeState {
  const profiles = basisItems.map((item) => ({
    sourceKind: item.sourceKind,
    adapterId: item.adapter?.id,
    role: item.role,
    primary: item.primary,
  }));
  const suggestions = suggestRecipes(profiles);
  const recommended = suggestions[0]?.recipe;
  const effective = selected ?? recommended;
  return { selected, recommended, effective };
}

export interface WorkbenchOutputs {
  basis: WorkbenchBasis;
  recipeState: WorkbenchRecipeState;
  recipeGate: Extract<BuildTaskSpecResult, { status: "insufficient-sources" }> | null;
  taskSpecJson: string | null;
  agentContext: string | null;
  sourceMarkdown: string | null;
  receipt: ContextReceipt | null;
  nutrition: ContextNutritionFacts | null;
  contentTokens: number;
}

export interface WorkbenchDeriveInput {
  cart: ContextCart;
  candidate: ContextSourceItem | null;
  selectedRecipe: RecipeId | null;
}

export function deriveWorkbenchOutputs(input: WorkbenchDeriveInput): WorkbenchOutputs {
  const basis = resolveWorkbenchBasis(input.cart, input.candidate);
  const recipeState = resolveRecipeState(basis.items, input.selectedRecipe);
  const emptyOutputs: WorkbenchOutputs = {
    basis,
    recipeState,
    recipeGate: null,
    taskSpecJson: null,
    agentContext: null,
    sourceMarkdown: null,
    receipt: null,
    nutrition: null,
    contentTokens: 0,
  };
  if (basis.items.length === 0 || recipeState.effective === undefined) {
    return emptyOutputs;
  }
  const cartForBuild: ContextCart =
    input.cart.items.length > 0 ? input.cart : { schemaVersion: 1, items: basis.items };

  const built = buildTaskSpec(cartForBuild, recipeState.effective);
  if (built.status !== "ok") {
    return { ...emptyOutputs, recipeGate: built };
  }
  const { spec } = built;

  const receipt = buildContextReceipt({
    sources: basis.items.map((item) => ({
      id: item.id,
      title: item.title,
      adapter: item.adapter,
      scope: item.scope,
      selectedLabels: item.selection?.labels ?? [],
      document: item.document,
    })),
    recipe: spec.recipe,
    task: { kind: spec.task.kind },
    unknowns: spec.unknowns,
    warnings: [],
  });
  const nutrition = buildContextNutritionFacts({
    spec,
    unknowns: spec.unknowns,
    warnings: [],
  });

  return {
    basis,
    recipeState,
    recipeGate: null,
    taskSpecJson: serializeTaskSpecJson(spec),
    agentContext: serializeAgentContext(spec),
    sourceMarkdown: serializeSourcesMarkdown(spec),
    receipt,
    nutrition,
    contentTokens: spec.estimates.sourceContentTokens,
  };
}

/** Gate message the UI shows when a recipe cannot run on the basis. */
export function recipeGateMessage(
  gate: Extract<BuildTaskSpecResult, { status: "insufficient-sources" }>,
): string {
  return `${getRecipeDefinition(gate.recipe).title} needs at least ${gate.required} sources.`;
}

export function addCandidateToCart(
  cart: ContextCart,
  candidate: ContextSourceItem,
):
  | { status: "added"; cart: ContextCart }
  | { status: "duplicate"; cart: ContextCart }
  | { status: "full"; cart: ContextCart } {
  // Shape role/primary against the CURRENT cart: only a first item becomes
  // the task/primary source; later items stay references and never steal it.
  const shaped: ContextSourceItem = {
    ...candidate,
    role: suggestInitialRole(candidate, cart),
    primary: suggestInitialPrimary(candidate, cart),
  };
  return addContextSource(cart, shaped);
}

export function primarySourceId(cart: ContextCart): string | undefined {
  return primaryContextSource(cart)?.id;
}

/** Fragment label used for text selections in receipts and dedupe keys. */
export function selectionLabelForExcerpt(excerpt: string): string {
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  return normalized.length === 0 ? "User text selection" : normalized.slice(0, 80);
}
