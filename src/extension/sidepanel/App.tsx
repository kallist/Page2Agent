/**
 * Page2Agent Side Panel — V1.1 Visual Context Workbench.
 *
 * Layout (top to bottom):
 *   header → capture state (idle/capturing/error) OR captured workbench:
 *   source card (adapter/scope/buttons) → Context Lens strip → text-selection
 *   CTA → recipe chooser → Context Cart → Agent|Markdown|TaskSpec tabs →
 *   Context Receipt + nutrition label → Copy/Download actions → feedback.
 *
 * Rendering rule: webpage content reaches the panel ONLY as structured,
 * validated data (NormalizedDocument blocks / serialized text) — never raw
 * HTML. All strings shown come from pure serializers.
 */
import { useMemo, useState } from "react";
import { useCaptureSession } from "./capture-session";
import { createProductionSessionDeps } from "./capture-session";
import type { CaptureSessionDeps } from "./capture-session";
import { useWorkbench } from "./use-workbench";
import type {
  LensUiState,
  WorkbenchController,
  WorkbenchDeps,
  WorkbenchFeedback,
} from "./use-workbench";
import type { WorkbenchOutputs } from "./workbench/workbench-model";
import { createProductionWorkbenchDeps } from "./workbench-ui/production-deps";
import { createPreview, PREVIEW_TRUNCATED_MESSAGE } from "./preview";
import { copyTextToClipboard } from "./clipboard";
import { downloadJson, downloadMarkdown } from "./download";
import { buildTaskSpecFilename } from "../../application/workbench/delivery";
import { sanitizeBaseName } from "../../application/delivery/filename";
import { computeCartTotals, estimateBlocksTokens } from "../../core";
import { getRecipeDefinition, RECIPE_IDS } from "../../core";
import type { ContextRole, ContextSourceItem, RecipeId, TaskSpec } from "../../core";
import {
  ITEM_SCOPE_LABELS,
  RECIPE_ICONS,
  RECIPE_TITLES,
  ROLE_ICONS,
  ROLE_TITLES,
  SOURCE_KIND_LABELS,
  adapterLabel,
  formatCapturedAt,
  formatEstimate,
  statusLabel,
} from "./workbench-ui/format";
import type { CaptureResult } from "../capture/capture-result";

const ROLES: readonly ContextRole[] = ["task", "reference", "evidence", "example", "selection"];

type FeedbackKindClass = "feedback-info" | "feedback-success" | "feedback-error";

function feedbackClass(kind: WorkbenchFeedback["kind"]): FeedbackKindClass {
  return kind === "success"
    ? "feedback-success"
    : kind === "error"
      ? "feedback-error"
      : "feedback-info";
}

export default function App({
  deps,
  workbench,
}: {
  deps?: CaptureSessionDeps;
  workbench?: WorkbenchDeps;
}) {
  const sessionDeps = useMemo(() => deps ?? createProductionSessionDeps(), [deps]);
  const workbenchDeps = useMemo(
    () => workbench ?? createProductionWorkbenchDeps(),
    [workbench],
  );
  const { view } = useCaptureSession(sessionDeps);

  return (
    <main className="panel">
      <header className="panel-header">
        <h1>Page2Agent</h1>
        <span className="panel-version">Visual Context Workbench</span>
      </header>

      {view.status === "idle" && <IdleView />}
      {view.status === "capturing" && <CapturingView />}
      {view.status === "error" && <ErrorView message={view.error.message} />}
      {view.status === "captured" && (
        <WorkbenchView result={view.result} workbenchDeps={workbenchDeps} />
      )}
    </main>
  );
}

function IdleView() {
  return (
    <section className="status-panel" aria-label="Extension status">
      <div className="status-mark">▣</div>
      <h2>No page captured yet</h2>
      <p>Click the Page2Agent toolbar icon on the page you want to understand.</p>
      <ol className="steps">
        <li><strong>Capture</strong> — Page2Agent identifies the page type</li>
        <li><strong>Pick</strong> — choose sections with Context Lens</li>
        <li><strong>Combine</strong> — add pages to the Context Cart</li>
        <li><strong>Task</strong> — pick what your agent should do</li>
        <li><strong>Inspect &amp; copy</strong> — see exactly what the agent gets</li>
      </ol>
    </section>
  );
}

function CapturingView() {
  return (
    <section className="status-panel" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>Capturing current page…</p>
    </section>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <section className="status-panel" aria-live="polite">
      <div className="status-mark status-mark-error" aria-hidden="true">!</div>
      <p className="error-text">{message}</p>
      <p className="muted">Click the Page2Agent toolbar icon to try again.</p>
    </section>
  );
}

function WorkbenchView({
  result,
  workbenchDeps,
}: {
  result: CaptureResult;
  workbenchDeps: WorkbenchDeps;
}) {
  const workbench = useWorkbench(workbenchDeps, result);
  const [activeTab, setActiveTab] = useState<"agent" | "markdown" | "taskspec">("agent");
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="workbench">
      <SourceCard workbench={workbench} result={result} sessionTitle={result.title} />

      {workbench.lens.phase !== "idle" && (
        <LensStrip lens={workbench.lens} workbench={workbench} />
      )}

      {workbench.lens.phase === "ready" && (
        <SelectionAction
          workbench={workbench}
          label={
            workbench.lens.selectedCount === 1
              ? "Use the picked area as a Context source"
              : `Use ${workbench.lens.selectedCount} picked areas as one Context source`
          }
        />
      )}

      {workbench.selectionAvailable === true && workbench.lens.phase === "idle" && (
        <div className="hint-row">
          <span>Text is selected on the page.</span>
          <button type="button" className="button button-secondary" onClick={() => void workbench.addTextSelection()}>
            + Add selection to Context
          </button>
        </div>
      )}

      {workbench.candidate !== null && <RecipeChooser workbench={workbench} />}

      <CartSection workbench={workbench} />

      {workbench.outputs !== null && workbench.outputs.recipeGate === null && (
        <PreviewTabs
          workbench={workbench}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          copied={copied}
          onCopied={setCopied}
          filenameBase={sanitizeBaseName(result.title)}
        />
      )}

      {workbench.outputs?.recipeGate !== null && workbench.outputs?.recipeGate !== undefined && (
        <p className="recipe-gate-note" role="status">
          {getRecipeDefinition(workbench.outputs.recipeGate.recipe).title} needs at least{" "}
          {workbench.outputs.recipeGate.required} sources in the Context.
        </p>
      )}

      {workbench.outputs !== null && (
        <ReceiptSection workbench={workbench} />
      )}

      <FeedbackList feedback={workbench.feedback} onDismiss={workbench.dismissFeedback} />
    </div>
  );
}

function SourceCard({
  workbench,
  result,
  sessionTitle,
}: {
  workbench: WorkbenchController;
  result: CaptureResult;
  sessionTitle: string;
}) {
  const candidate = workbench.candidate;
  const sourceLabel = SOURCE_KIND_LABELS[result.sourceKind] ?? "Web Page";
  const tokens = candidate === null ? null : candidateTokens(candidate);
  const docMissing = workbench.ready && candidate === null;

  return (
    <section className="source-card" aria-label="Captured source">
      <div className="badge-row">
        <span className="badge badge-source">{sourceLabel}</span>
        {candidate?.adapter !== undefined && (
          <span className="badge badge-adapter">{adapterLabel(candidate.adapter)}</span>
        )}
        {candidate?.scope !== undefined && candidate.scope !== "full-page" && (
          <span className="badge badge-scope">{ITEM_SCOPE_LABELS[candidate.scope] ?? candidate.scope}</span>
        )}
      </div>
      <h2 className="source-title" title={result.title}>
        {result.title || sessionTitle}
      </h2>
      <p className="source-url" title={result.url}>
        {result.url}
      </p>
      <p className="source-meta">
        {formatCapturedAt(result.capturedAt)}
        {tokens !== null && <span className="dot-sep">{formatEstimate(tokens)}</span>}
      </p>

      {docMissing && (
        <p className="warn-note">
          This capture&apos;s structured document is unavailable (browser restart or
          navigation). Click the toolbar icon to capture again.
        </p>
      )}

      <div className="action-row">
        <button
          type="button"
          className="button button-primary"
          disabled={workbench.candidate === null || workbench.lens.phase === "entering" || workbench.lens.phase === "active"}
          onClick={() => void workbench.pickOnPage()}
        >
          Pick Context
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={workbench.candidate === null}
          onClick={() => void workbench.addCaptureToCart()}
        >
          + Add to Context
        </button>
      </div>
    </section>
  );
}

function LensStrip({
  lens,
  workbench,
}: {
  lens: LensUiState;
  workbench: WorkbenchController;
}) {
  const live = lens.active;
  return (
    <section className="lens-strip" aria-live="polite">
      <div className="lens-copy">
        {live ? (
          <span>Context Lens is on the page — click areas to include, then Done in the dock.</span>
        ) : (
          <span>
            {lens.selectedCount} area{lens.selectedCount === 1 ? "" : "s"} picked ·{" "}
            {formatEstimate(lens.estimatedTokens)}
          </span>
        )}
      </div>
      <button
        type="button"
        className="button button-ghost"
        disabled={lens.phase === "entering" || lens.phase === "adding"}
        onClick={() => void workbench.discardPickedSections()}
      >
        Cancel
      </button>
    </section>
  );
}

function SelectionAction({
  workbench,
  label,
}: {
  workbench: WorkbenchController;
  label: string;
}) {
  return (
    <div className="selection-action">
      <span className="selection-summary">
        {label} · {formatEstimate(workbench.lens.estimatedTokens)}
      </span>
      <button
        type="button"
        className="button button-primary"
        disabled={workbench.lens.phase === "adding"}
        onClick={() => void workbench.addPickedSections()}
      >
        Add to Context
      </button>
    </div>
  );
}

function RecipeChooser({ workbench }: { workbench: WorkbenchController }) {
  const outputs = workbench.outputs;
  const recommended = outputs?.recipeState.recommended;
  const effective = outputs?.recipeState.effective;
  const sourceCount = outputs?.basis.items.length ?? 0;

  return (
    <section className="section" aria-label="What do you want to do">
      <h3 className="section-title">What do you want to do?</h3>
      <div className="recipe-grid" role="radiogroup" aria-label="Recipe">
        {RECIPE_IDS.map((recipe: RecipeId) => {
          const definition = getRecipeDefinition(recipe);
          const insufficient = sourceCount < definition.minSources;
          const selected = effective === recipe;
          return (
            <button
              key={recipe}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={insufficient}
              className={[
                "recipe-button",
                selected ? "recipe-button-selected" : "",
                recommended === recipe ? "recipe-recommended" : "",
                insufficient ? "recipe-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={insufficient ? `${definition.title} needs ${definition.minSources} sources.` : definition.description}
              onClick={() => workbench.setRecipe(recipe)}
            >
              <span className="recipe-icon" aria-hidden="true">
                {RECIPE_ICONS[recipe]}
              </span>
              <span className="recipe-name">{RECIPE_TITLES[recipe]}</span>
              {recommended === recipe && <span className="recipe-chip">Recommended</span>}
            </button>
          );
        })}
      </div>
      {sourceCount < 2 && (
        <p className="muted">Compare needs at least two sources in the Context.</p>
      )}
    </section>
  );
}

function CartSection({ workbench }: { workbench: WorkbenchController }) {
  const { cart } = workbench;
  const totals = useMemo(() => computeCartTotals(cart), [cart]);
  const hasItems = cart.items.length > 0;

  return (
    <section className="section" aria-label="Context Cart">
      <div className="section-head">
        <h3 className="section-title">
          Context Cart
          {hasItems && <span className="count-badge">{cart.items.length}</span>}
        </h3>
        <div className="section-actions">
          {cart.undo !== undefined && hasItems === false && (
            <button type="button" className="button button-ghost" onClick={() => workbench.cartUndo()}>
              Undo
            </button>
          )}
          {cart.undo !== undefined && hasItems && (
            <button type="button" className="button button-ghost" onClick={() => workbench.cartUndo()}>
              Undo
            </button>
          )}
          {hasItems && (
            <button type="button" className="button button-ghost" onClick={() => workbench.cartClear()}>
              Clear
            </button>
          )}
        </div>
      </div>

      {!hasItems ? (
        <p className="muted cart-empty">
          Your cart is empty. Add the current page or picked sections — several sources
          become one agent context.
        </p>
      ) : (
        <>
          <ul className="cart-list">
            {cart.items.map((item, index) => (
              <CartItemRow
                key={item.id}
                item={item}
                index={index}
                count={cart.items.length}
                workbench={workbench}
              />
            ))}
          </ul>
          <p className="cart-total">
            {totals.count} source{totals.count === 1 ? "" : "s"} · {formatEstimate(totals.tokenEstimate)}
          </p>
        </>
      )}
    </section>
  );
}

function CartItemRow({
  item,
  index,
  count,
  workbench,
}: {
  item: ContextSourceItem;
  index: number;
  count: number;
  workbench: WorkbenchController;
}) {
  const label = SOURCE_KIND_LABELS[item.sourceKind] ?? "Web Page";
  const tokens = candidateTokens(item);
  return (
    <li className="cart-item">
      <div className="cart-item-main">
        <span className="cart-grip" aria-hidden="true">⋮⋮</span>
        <div className="cart-item-text">
          <div className="cart-item-title-row">
            <span className="cart-item-title" title={item.title}>
              {item.title}
            </span>
            {item.primary && <span className="badge badge-primary">Primary</span>}
          </div>
          <p className="cart-item-sub" title={item.url}>
            {label}
            {item.adapter !== undefined && ` · ${adapterLabel(item.adapter)}`}
            {item.scope !== "full-page" && ` · ${ITEM_SCOPE_LABELS[item.scope] ?? item.scope}`}
          </p>
          <p className="cart-item-meta">{formatEstimate(tokens)}</p>
        </div>
      </div>
      <div className="cart-item-controls">
        <div className="cart-move">
          <button
            type="button"
            className="icon-button"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => workbench.cartMove(item.id, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => workbench.cartMove(item.id, 1)}
          >
            ↓
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={item.primary ? "Clear primary" : "Set as primary"}
          aria-pressed={item.primary}
          title="Set as primary"
          onClick={() => {
            if (!item.primary) {
              workbench.cartSetPrimary(item.id);
            }
          }}
        >
          ★
        </button>
        <label className="role-select">
          <span className="sr-only">Role for {item.title}</span>
          <select
            value={item.role}
            aria-label={`Role for ${item.title}`}
            onChange={(event) => {
              const role = event.target.value as ContextRole;
              if (ROLES.includes(role)) {
                workbench.cartSetRole(item.id, role);
              }
            }}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_ICONS[role]} {ROLE_TITLES[role]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-button icon-danger"
          aria-label={`Remove ${item.title}`}
          title="Remove"
          onClick={() => workbench.cartRemove(item.id)}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

type TabId = "agent" | "markdown" | "taskspec";

function PreviewTabs({
  workbench,
  activeTab,
  onTabChange,
  copied,
  onCopied,
  filenameBase,
}: {
  workbench: WorkbenchController;
  activeTab: TabId;
  onTabChange(tab: TabId): void;
  copied: string | null;
  onCopied(kind: string | null): void;
  filenameBase: string;
}) {
  const outputs = workbench.outputs!;
  const content =
    activeTab === "agent"
      ? outputs.agentContext
      : activeTab === "markdown"
        ? outputs.sourceMarkdown
        : outputs.taskSpecJson;
  const preview = useMemo(
    () => createPreview(content ?? ""),
    [content],
  );

  async function copyActive(): Promise<void> {
    if (content === null) {
      return;
    }
    try {
      await copyTextToClipboard(content);
      onCopied(activeTab);
    } catch {
      onCopied("error");
    }
  }

  function downloadActive(): void {
    if (content === null) {
      return;
    }
    const slug = filenameBase || "page2agent";
    if (activeTab === "taskspec") {
      const spec = JSON.parse(outputs.taskSpecJson!) as TaskSpec;
      downloadJson(buildTaskSpecFilename(spec), content);
    } else {
      downloadMarkdown(`${slug}-context.md`, content);
    }
  }

  return (
    <section className="section" aria-label="Agent output">
      <div className="tabs" role="tablist" aria-label="Preview type">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "agent"}
          className={activeTab === "agent" ? "tab active" : "tab"}
          onClick={() => onTabChange("agent")}
        >
          Agent
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "markdown"}
          className={activeTab === "markdown" ? "tab active" : "tab"}
          onClick={() => onTabChange("markdown")}
        >
          Markdown
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "taskspec"}
          className={activeTab === "taskspec" ? "tab active" : "tab"}
          onClick={() => onTabChange("taskspec")}
        >
          TaskSpec
        </button>
      </div>

      <div
        role="tabpanel"
        className="preview-body"
        aria-label={`${activeTab} preview`}
      >
        <pre>{preview.text}</pre>
        {preview.truncated && <p className="preview-note">{PREVIEW_TRUNCATED_MESSAGE}</p>}
      </div>

      <div className="action-row action-row-end">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void copyActive()}
        >
          {activeTab === "taskspec" ? "Copy JSON" : "Copy"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={downloadActive}
        >
          {activeTab === "taskspec" ? "Download JSON" : "Download"}
        </button>
      </div>

      <p className="feedback-line" role="status" aria-live="polite">
        {copied === "error" && "Could not copy to the clipboard. Please try again."}
        {copied !== null && copied !== "error" && "Copied."}
      </p>
    </section>
  );
}

function ReceiptSection({ workbench }: { workbench: WorkbenchController }) {
  const outputs = workbench.outputs!;
  const receipt = outputs.receipt!;
  const nutrition = outputs.nutrition!;
  const selectedLabel =
    workbench.selectedRecipe !== null
      ? RECIPE_TITLES[workbench.selectedRecipe]
      : undefined;

  return (
    <section className="section receipt" aria-label="Context Receipt">
      <div className="section-head">
        <h3 className="section-title">Context Receipt</h3>
        <span className={`status-pill pill-${nutrition.status}`}>
          {statusLabel(nutrition.status)}
        </span>
      </div>

      {selectedLabel !== undefined && (
        <p className="receipt-recipe">Recipe: {selectedLabel}</p>
      )}
      <p className="receipt-tokens">{formatEstimate(receipt.tokenEstimate.tokens)} of source content</p>

      <ul className="receipt-rows">
        {receipt.sources.map((source) => (
          <li key={source.id} className="receipt-source">
            <div className="receipt-source-head">
              <span className="receipt-source-title" title={source.title}>
                {source.title}
              </span>
              {source.adapter !== undefined && (
                <span className="muted">{source.adapter.name}</span>
              )}
            </div>
            <CheckList label="Included" items={source.included} marker="✓" />
            <CheckList label="Excluded" items={source.excluded} marker="×" muted />
          </li>
        ))}
      </ul>

      {receipt.generated.length > 0 && (
        <ListBlock title="Generated" items={receipt.generated.map((entry) => entry)} />
      )}
      {receipt.unknowns.length > 0 && (
        <ListBlock title="Unknown" items={receipt.unknowns} />
      )}

      <NutritionFacts nutrition={nutrition} />
    </section>
  );
}

function CheckList({
  label,
  items,
  marker,
  muted = false,
}: {
  label: string;
  items: string[];
  marker: string;
  muted?: boolean;
}) {
  return (
    <div className="receipt-list">
      <h4>{label}</h4>
      {items.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item} className={muted ? "muted" : undefined}>
              <span className="marker" aria-hidden="true">
                {marker}
              </span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="receipt-list">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NutritionFacts({ nutrition }: { nutrition: NonNullable<WorkbenchOutputs["nutrition"]> }) {
  const rows = [
    { label: "Source content", percent: nutrition.sourceContentPercent },
    { label: "Generated instructions", percent: nutrition.generatedPercent },
    { label: "Metadata", percent: nutrition.metadataPercent },
  ];
  return (
    <div className="nutrition">
      <h4>Context facts</h4>
      <p className="nutrition-tokens">{formatEstimate(nutrition.estimatedTokens)} total</p>
      <div className="nutrition-bars">
        {rows.map((row) => (
          <div key={row.label} className="nutrition-row">
            <span className="nutrition-label">{row.label}</span>
            <div className="bar-track" role="img" aria-label={`${row.label} ${row.percent}%`}>
              <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} />
            </div>
            <span className="nutrition-percent">{row.percent}%</span>
          </div>
        ))}
      </div>
      <dl className="nutrition-facts">
        <div>
          <dt>Sources</dt>
          <dd>{nutrition.counts.sources}</dd>
        </div>
        <div>
          <dt>Code blocks</dt>
          <dd>{nutrition.counts.codeBlocks}</dd>
        </div>
        <div>
          <dt>Tables</dt>
          <dd>{nutrition.counts.tables}</dd>
        </div>
        <div>
          <dt>Links</dt>
          <dd>{nutrition.counts.links}</dd>
        </div>
      </dl>
      <dl className="nutrition-flags">
        <div>
          <dt>Explicit acceptance criteria</dt>
          <dd>
            {nutrition.explicitAcceptanceCriteria === null
              ? "—"
              : nutrition.explicitAcceptanceCriteria
                ? "✓"
                : "✗"}
          </dd>
        </div>
        <div>
          <dt>Provenance</dt>
          <dd>{nutrition.provenanceComplete ? "✓" : "✗"}</dd>
        </div>
      </dl>
    </div>
  );
}

function FeedbackList({
  feedback,
  onDismiss,
}: {
  feedback: WorkbenchFeedback[];
  onDismiss(id: number): void;
}) {
  return (
    <div className="feedback-list" aria-live="polite">
      {feedback.map((entry) => (
        <div key={entry.id} className={`feedback ${feedbackClass(entry.kind)}`} role="status">
          <span>{entry.message}</span>
          <button
            type="button"
            className="feedback-dismiss"
            aria-label="Dismiss"
            onClick={() => onDismiss(entry.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function candidateTokens(item: ContextSourceItem): number {
  return estimateBlocksTokens(item.document.blocks);
}
