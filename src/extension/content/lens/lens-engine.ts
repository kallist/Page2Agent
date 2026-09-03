/**
 * Context Lens engine — in-page visual picking controller (V1.1).
 *
 * The engine owns the lens lifecycle on one page:
 * - activation adds ONE shadow-root host (never touches the page tree),
 * - hover/click/keyboard listeners are registered and removed with the
 *   engine, rAF-throttled overlay updates only reposition shadows,
 * - picks are plain Element references — the page DOM is never mutated,
 *   so cleanup is structural: remove host + listeners + pending rAF.
 */
import type { LensRegion } from "./semantic-region";
import { regionLabel, resolveRegionUnder } from "./semantic-region";

export const LENS_HOST_ID = "page2agent-context-lens-host";

export interface LensEngineSnapshot {
  active: boolean;
  selectedCount: number;
  estimatedTokens: number;
}

export interface LensEngineDeps {
  document: Document;
  window: Window;
  /** Called whenever inclusion state or activity changes. */
  onState?: (snapshot: LensEngineSnapshot) => void;
  /** Called once when the user clicks Done with selections retained. */
  onFinish?: () => void;
}

interface Pick {
  region: LensRegion;
}

export interface LensEngine {
  isActive(): boolean;
  snapshot(): LensEngineSnapshot;
  /** Enter lens mode (idempotent). Clears any retained picks. */
  activate(): boolean;
  /** Cancel: leave lens mode and discard picks. */
  deactivate(): boolean;
  /** Done: leave lens mode but RETAIN picks for materialization. */
  finish(): boolean;
  /** Remove all picks while staying active. */
  reset(): boolean;
  /** Drop retained picks after they were handed off (or discarded). */
  clearSelections(): boolean;
  /** Toggle one region in/out (used by UI handlers and tests). */
  toggleRegion(region: LensRegion): boolean;
  /** Regions currently included, in pick order. */
  selectedRegions(): readonly LensRegion[];
}

export function createLensEngine(deps: LensEngineDeps): LensEngine {
  const { document, window } = deps;
  let active = false;
  let picks: Pick[] = [];
  let hoverRegion: LensRegion | null = null;
  let lastHoverElement: Element | null = null;
  let rafId: number | null = null;
  let cancelAnimationFrameHandle: ((handle: number) => void) | null = null;
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let highlightLayer: HTMLElement | null = null;
  let chip: HTMLElement | null = null;
  let dock: HTMLElement | null = null;
  let countLabel: HTMLElement | null = null;
  let meter: HTMLElement | null = null;
  let cleanupRemoveHandler: (() => void) | null = null;
  let cleanupWheelHandler: (() => void) | null = null;
  let cleanupResizeHandler: (() => void) | null = null;
  let cleanupScrollHandler: (() => void) | null = null;

  function snapshot(): LensEngineSnapshot {
    const tokens = picks.reduce((sum, pick) => sum + pick.region.estimatedTokens, 0);
    return { active, selectedCount: picks.length, estimatedTokens: tokens };
  }

  function publish(): void {
    deps.onState?.(snapshot());
  }

  function activate(): boolean {
    if (active) {
      return false;
    }
    active = true;
    picks = [];
    hoverRegion = null;
    lastHoverElement = null;
    buildOverlay();
    registerListeners();
    publish();
    return true;
  }

  function deactivate(): boolean {
    if (!active) {
      return false;
    }
    active = false;
    picks = [];
    cancelFrame();
    unregisterListeners();
    removeHost();
    publish();
    return true;
  }

  function finish(): boolean {
    if (!active) {
      return false;
    }
    active = false;
    cancelFrame();
    unregisterListeners();
    removeHost();
    publish();
    deps.onFinish?.();
    return true;
  }

  function clearSelections(): boolean {
    const hadPicks = picks.length > 0;
    picks = [];
    if (active) {
      drawHighlights();
      updateDock();
    }
    if (hadPicks) {
      publish();
    }
    return true;
  }

  function reset(): boolean {
    if (!active) {
      return false;
    }
    picks = [];
    drawHighlights();
    updateDock();
    publish();
    return true;
  }

  function toggleRegion(region: LensRegion): boolean {
    if (!active) {
      return false;
    }
    const index = picks.findIndex((pick) => sameElements(pick.region.elements, region.elements));
    if (index >= 0) {
      picks.splice(index, 1);
    } else {
      picks.push({ region });
    }
    hoverRegion = null;
    hideChip();
    drawHighlights();
    updateDock();
    publish();
    return true;
  }

  function selectedRegions(): readonly LensRegion[] {
    return picks.map((pick) => pick.region);
  }

  // ---------------------------------------------------------------------
  // Event handling (capture phase; removed on deactivate)
  // ---------------------------------------------------------------------

  function handleMouseOver(event: MouseEvent): void {
    if (!active) {
      return;
    }
    const target = elementLike(event.target);
    if (target === null || target.closest(`#${LENS_HOST_ID}`) !== null) {
      return;
    }
    if (isInteractiveControl(target)) {
      hideChip();
      hoverRegion = null;
      lastHoverElement = target;
      return;
    }
    if (target === lastHoverElement) {
      return;
    }
    lastHoverElement = target;
    const region = resolveRegionUnder(target);
    if (region === null) {
      hideChip();
      hoverRegion = null;
      return;
    }
    hoverRegion = region;
    scheduleFrame(() => {
      if (!active || hoverRegion === null) {
        return;
      }
      if (lastHoverElement !== null && lastHoverElement.isConnected) {
        showChip(hoverRegion, event.clientX, event.clientY);
      }
    });
  }

  function handleClick(event: MouseEvent): void {
    if (!active) {
      return;
    }
    const target = elementLike(event.target);
    if (target === null) {
      return;
    }
    if (target.closest(`#${LENS_HOST_ID}`) !== null) {
      return; // dock buttons are real DOM; let them handle their own clicks
    }
    if (event.button !== 0) {
      return;
    }
    if (isInteractiveControl(target)) {
      return; // forms stay usable; they are never content picks
    }
    event.preventDefault();
    event.stopPropagation();
    const region = resolveRegionUnder(target);
    if (region !== null) {
      toggleRegion(region);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!active) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      deactivate();
    }
  }

  function handleWheel(): void {
    scheduleFrame(drawHighlights);
  }

  function handleViewportChange(): void {
    scheduleFrame(drawHighlights);
  }

  // ---------------------------------------------------------------------
  // Overlay DOM (shadow root — never part of the page tree semantics)
  // ---------------------------------------------------------------------

  function buildOverlay(): void {
    // A crashed/previous session may have left a host behind (same id) —
    // remove it before creating ours so UI never stacks or leaks.
    document.getElementById(LENS_HOST_ID)?.remove();
    host = document.createElement("div");
    host.id = LENS_HOST_ID;
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = LENS_STYLES;
    shadow.appendChild(style);

    highlightLayer = document.createElement("div");
    highlightLayer.className = "p2a-highlights";
    shadow.appendChild(highlightLayer);

    chip = document.createElement("div");
    chip.className = "p2a-chip";
    chip.setAttribute("role", "status");
    shadow.appendChild(chip);

    dock = document.createElement("div");
    dock.className = "p2a-dock";
    dock.setAttribute("role", "dialog");
    dock.setAttribute("aria-label", "Context Lens");
    const hint = document.createElement("div");
    hint.className = "p2a-hint";
    hint.textContent = "Click a highlighted area to include it · Esc to cancel";
    dock.appendChild(hint);
    countLabel = document.createElement("div");
    countLabel.className = "p2a-count";
    countLabel.setAttribute("aria-live", "polite");
    dock.appendChild(countLabel);
    meter = document.createElement("div");
    meter.className = "p2a-meter";
    meter.setAttribute("aria-hidden", "true");
    dock.appendChild(meter);
    const controls = document.createElement("div");
    controls.className = "p2a-controls";
    const cancelButton = makeButton("Cancel", "Cancel picking (Esc)", () => {
      deactivate();
    });
    const resetButton = makeButton("Reset", "Clear all selections", () => {
      reset();
    });
    const doneButton = makeButton("Done", "Finish picking", () => {
      finish();
    });
    controls.append(cancelButton, resetButton, doneButton);
    dock.appendChild(controls);
    shadow.appendChild(dock);

    document.documentElement.appendChild(host);
    drawHighlights();
    updateDock();
  }

  function makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "p2a-button";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function removeHost(): void {
    if (host !== null) {
      host.remove();
    }
    host = null;
    shadow = null;
    highlightLayer = null;
    chip = null;
    dock = null;
    countLabel = null;
    meter = null;
  }

  // ---------------------------------------------------------------------
  // Drawing (rAF-throttled; getBoundingClientRect only at draw time)
  // ---------------------------------------------------------------------

  function scheduleFrame(draw: () => void): void {
    if (rafId !== null) {
      return;
    }
    const requestFrame =
      window.requestAnimationFrame?.bind(window) ??
      ((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(0), 16) as unknown as number);
    const cancelFrameByHandle =
      window.cancelAnimationFrame?.bind(window) ??
      ((handle: number) => window.clearTimeout(handle));
    rafId = requestFrame(() => {
      rafId = null;
      if (active) {
        draw();
      }
    });
    // keep the native cancel path available for the fallback too
    cancelAnimationFrameHandle = cancelFrameByHandle;
  }

  function cancelFrame(): void {
    if (rafId !== null) {
      if (cancelAnimationFrameHandle !== null) {
        cancelAnimationFrameHandle(rafId);
      } else if (window.cancelAnimationFrame !== undefined) {
        window.cancelAnimationFrame(rafId);
      } else {
        window.clearTimeout(rafId);
      }
      rafId = null;
      cancelAnimationFrameHandle = null;
    }
  }

  function drawHighlights(): void {
    if (highlightLayer === null) {
      return;
    }
    // Rebuild highlight rectangles from live element geometry each frame.
    highlightLayer.textContent = "";
    for (const pick of picks) {
      for (const element of pick.region.elements) {
        if (!element.isConnected) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          continue;
        }
        const marker = document.createElement("div");
        marker.className = "p2a-highlight";
        marker.style.left = `${rect.left}px`;
        marker.style.top = `${rect.top}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
        highlightLayer.appendChild(marker);
      }
    }
  }

  function updateDock(): void {
    if (dock === null) {
      return;
    }
    const state = snapshot();
    if (countLabel !== null) {
      countLabel.textContent =
        state.selectedCount === 0
          ? "No context selected yet"
          : `${state.selectedCount} area${state.selectedCount === 1 ? "" : "s"} selected · ~${formatTokens(state.estimatedTokens)} estimated tokens`;
    }
    if (meter !== null) {
      meter.textContent = state.selectedCount === 0 ? "" : "●".repeat(Math.min(12, state.selectedCount));
    }
  }

  function showChip(region: LensRegion, x: number, y: number): void {
    if (chip === null) {
      return;
    }
    const included = picks.some((pick) => sameElements(pick.region.elements, region.elements));
    chip.textContent = `${included ? "✓ Included · " : ""}${truncate(regionLabel(region), 56)} · ~${formatTokens(region.estimatedTokens)} tokens`;
    chip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 16)}px)`;
    chip.style.display = "block";
  }

  function hideChip(): void {
    if (chip !== null) {
      chip.style.display = "none";
    }
  }

  // ---------------------------------------------------------------------
  // Listeners + cleanup
  // ---------------------------------------------------------------------

  function registerListeners(): void {
    const add = (type: string, handler: (event: Event) => void): void => {
      document.addEventListener(type, handler, true);
    };
    add("mouseover", handleMouseOver as EventListener);
    add("click", handleClick as EventListener);
    add("keydown", handleKeyDown as EventListener);
    cleanupRemoveHandler = () => {
      document.removeEventListener("mouseover", handleMouseOver as EventListener, true);
      document.removeEventListener("click", handleClick as EventListener, true);
      document.removeEventListener("keydown", handleKeyDown as EventListener, true);
    };
    // Reposition highlights while the user scrolls or resizes.
    const wheelListener = (): void => handleWheel();
    const viewportListener = (): void => handleViewportChange();
    window.addEventListener("wheel", wheelListener, { passive: true });
    window.addEventListener("resize", viewportListener);
    window.addEventListener("scroll", viewportListener, true);
    cleanupWheelHandler = () => window.removeEventListener("wheel", wheelListener);
    cleanupResizeHandler = () => window.removeEventListener("resize", viewportListener);
    cleanupScrollHandler = () => window.removeEventListener("scroll", viewportListener, true);
    // If the page unloads mid-lens, remove everything without timers.
    window.addEventListener("pagehide", cleanupNow);
  }

  function cleanupNow(): void {
    cancelFrame();
    if (cleanupRemoveHandler !== null) {
      cleanupRemoveHandler();
      cleanupRemoveHandler = null;
    }
    if (cleanupWheelHandler !== null) {
      cleanupWheelHandler();
      cleanupWheelHandler = null;
    }
    if (cleanupResizeHandler !== null) {
      cleanupResizeHandler();
      cleanupResizeHandler = null;
    }
    if (cleanupScrollHandler !== null) {
      cleanupScrollHandler();
      cleanupScrollHandler = null;
    }
    window.removeEventListener("pagehide", cleanupNow);
    removeHost();
  }

  function unregisterListeners(): void {
    cleanupNow();
  }

  return {
    isActive: () => active,
    snapshot,
    activate,
    deactivate,
    finish,
    clearSelections,
    reset,
    toggleRegion,
    selectedRegions,
  };
}

function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((element, index) => element === b[index]);
}

const INTERACTIVE_CONTROL_SELECTOR =
  "button, input, select, textarea, [contenteditable='true'], [role='button']";

function isInteractiveControl(element: Element): boolean {
  return element.closest(INTERACTIVE_CONTROL_SELECTOR) !== null;
}

/**
 * Cross-realm-safe element detection. Content scripts and jsdom test
 * documents can hand us nodes from another realm where `instanceof Element`
 * fails; duck-typing on the DOM API keeps the engine realm-agnostic.
 */
function elementLike(value: unknown): Element | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { closest?: unknown; tagName?: unknown };
  if (typeof candidate.closest === "function" && typeof candidate.tagName === "string") {
    return value as Element;
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

const LENS_STYLES = `
:host { all: initial; }
.p2a-highlights { position: fixed; inset: 0; pointer-events: none; }
.p2a-highlight {
  position: fixed;
  border: 1.5px solid rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.10);
  border-radius: 3px;
  box-sizing: border-box;
  pointer-events: none;
}
.p2a-chip {
  display: none;
  position: fixed;
  top: 0; left: 0;
  max-width: 320px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.92);
  color: #f9fafb;
  font: 12px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
}
.p2a-dock {
  position: fixed;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  max-width: min(92vw, 560px);
  background: rgba(255, 255, 255, 0.98);
  color: #111827;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  pointer-events: auto;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.p2a-hint { color: #4b5563; }
.p2a-count { font-weight: 600; }
.p2a-meter { color: #2563eb; letter-spacing: 1px; }
.p2a-controls { display: flex; gap: 8px; margin-left: auto; }
.p2a-button {
  appearance: none;
  border: 1px solid rgba(17, 24, 39, 0.15);
  background: #ffffff;
  color: #111827;
  border-radius: 7px;
  padding: 5px 12px;
  font: inherit;
  cursor: pointer;
}
.p2a-button:hover { background: #f3f4f6; }
.p2a-button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
.p2a-dock button:last-child { background: #2563eb; border-color: #2563eb; color: #fff; }
.p2a-dock button:last-child:hover { background: #1d4ed8; }
@media (prefers-reduced-motion: reduce) {
  .p2a-dock, .p2a-chip { transition: none; }
}
`;
