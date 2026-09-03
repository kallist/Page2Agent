/**
 * useWorkbench — Side Panel V1.1 state orchestration hook.
 *
 * Owns the interaction between the capture session, the per-window document
 * cache, the Context Cart (session storage), the Context Lens client and the
 * pure workbench view model. All side effects go through the injected deps
 * object so tests use fakes; async continuations are capture-guarded so a
 * stale capture never mutates newer UI state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCandidateToCart,
  createCandidateContextItem,
  deriveWorkbenchOutputs,
  selectionLabelForExcerpt,
} from "./workbench/workbench-model";
import type { WorkbenchOutputs } from "./workbench/workbench-model";
import { readWindowDocumentForCapture } from "../session/document-cache";
import { readCart, saveCart } from "./workbench/cart-session";
import type { PanelLensClient } from "./workbench/lens-client";
import type { SessionStorage } from "../session/session-storage";
import type { CaptureResult } from "../capture/capture-result";
import {
  clearContextCart,
  createContextSourceId,
  isContextCart,
  moveContextSource,
  removeContextSource,
  setContextSourceRole,
  setPrimaryContextSource,
  undoContextCartChange,
} from "../../core";
import type {
  ContextCart,
  ContextRole,
  ContextSourceItem,
  NormalizedDocument,
  RecipeId,
} from "../../core";
import { isLensStateEvent } from "../messaging/lens-messages";

export interface WorkbenchDeps {
  storage: SessionStorage;
  windowId(): Promise<number>;
  lens: PanelLensClient;
  subscribeMessages(listener: (message: unknown) => void): () => void;
}

export type LensPhase =
  | "idle"
  | "entering"
  | "active"
  | "ready" // Done clicked with retained picks, materialization available
  | "adding";

export interface LensUiState {
  phase: LensPhase;
  active: boolean;
  selectedCount: number;
  estimatedTokens: number;
}

export type FeedbackKind = "info" | "success" | "error";

export interface WorkbenchFeedback {
  id: number;
  kind: FeedbackKind;
  message: string;
}

export interface WorkbenchController {
  ready: boolean;
  cart: ContextCart;
  candidate: ContextSourceItem | null;
  lens: LensUiState;
  selectionAvailable: boolean | null;
  selectedRecipe: RecipeId | null;
  outputs: WorkbenchOutputs | null;
  feedback: WorkbenchFeedback[];
  dismissFeedback(id: number): void;
  addCaptureToCart(): Promise<void>;
  addPickedSections(): Promise<void>;
  discardPickedSections(): Promise<void>;
  pickOnPage(): Promise<void>;
  addTextSelection(): Promise<void>;
  setRecipe(recipe: RecipeId): void;
  clearRecipeChoice(): void;
  cartMove(itemId: string, direction: -1 | 1): void;
  cartRemove(itemId: string): void;
  cartUndo(): void;
  cartClear(): void;
  cartSetRole(itemId: string, role: ContextRole): void;
  cartSetPrimary(itemId: string): void;
}

const IDLE_LENS: LensUiState = {
  phase: "idle",
  active: false,
  selectedCount: 0,
  estimatedTokens: 0,
};

function errorMessage(error: { code: string; message: string } | undefined): string {
  return error?.message ?? "The action could not be completed.";
}

let feedbackSequence = 0;

export function useWorkbench(
  deps: WorkbenchDeps,
  result: CaptureResult | null,
): WorkbenchController {
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<ContextCart>({ schemaVersion: 1, items: [] });
  const [candidate, setCandidate] = useState<ContextSourceItem | null>(null);
  const [lens, setLens] = useState<LensUiState>(IDLE_LENS);
  const [selectionAvailable, setSelectionAvailable] = useState<boolean | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeId | null>(null);
  const [feedback, setFeedback] = useState<WorkbenchFeedback[]>([]);
  const windowIdRef = useRef<number | null>(null);
  const resultRef = useRef<CaptureResult | null>(null);
  const depsRef = useRef(deps);

  // Keep the latest render values reachable from stable listeners/effects.
  useEffect(() => {
    depsRef.current = deps;
    resultRef.current = result;
  });

  const captureId = result?.captureId ?? null;

  const notice = useCallback((message: string, kind: FeedbackKind = "info") => {
    feedbackSequence += 1;
    const entry: WorkbenchFeedback = { id: feedbackSequence, kind, message };
    setFeedback((current) => [...current.slice(-2), entry]);
  }, []);

  const dismissFeedback = useCallback((id: number) => {
    setFeedback((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const sessionOf = useCallback((capture: CaptureResult) => {
    return {
      captureId: capture.captureId,
      url: capture.url,
      title: capture.title,
      capturedAt: capture.capturedAt,
    };
  }, []);

  const applyCart = useCallback(
    (nextCart: ContextCart): void => {
      setCart(nextCart);
      const windowId = windowIdRef.current;
      if (windowId !== null) {
        saveCart(deps.storage, windowId, nextCart).catch(() => {
          notice("Could not save the Context Cart.", "error");
        });
      }
    },
    [deps, notice],
  );

  // 1. Window namespace + per-capture state loading.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      // Reset per-capture ephemeral state before loading the next capture.
      setReady(false);
      setSelectionAvailable(null);
      setLens(IDLE_LENS);
      setCandidate(null);
      if (captureId !== null) {
        setSelectedRecipe(null);
      }
      const current = resultRef.current;
      if (current === null) {
        setReady(true);
        return;
      }
      if (windowIdRef.current === null) {
        try {
          windowIdRef.current = await depsRef.current.windowId();
        } catch {
          notice("Could not resolve this browser window.", "error");
          setReady(true);
          return;
        }
      }
      const windowId = windowIdRef.current;
      try {
        const [rawCart, document] = await Promise.all([
          readCart(depsRef.current.storage, windowId),
          readWindowDocumentForCapture(depsRef.current.storage, windowId, current.captureId),
        ]);
        if (cancelled) {
          return;
        }
        if (isContextCart(rawCart)) {
          setCart(rawCart);
        }
        if (document !== null) {
          setCandidate(
            createCandidateContextItem(document, {
              captureId: current.captureId,
              url: current.url,
              title: current.title,
              capturedAt: current.capturedAt,
            }),
          );
        }
      } catch {
        if (!cancelled) {
          notice("Could not restore your session state.", "error");
        }
      }
      if (!cancelled) {
        setReady(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureId, deps]);

  // 2. Live lens state events (content script broadcasts).
  useEffect(() => {
    return deps.subscribeMessages((message) => {
      if (!isLensStateEvent(message)) {
        return;
      }
      const current = resultRef.current;
      if (current === null || message.captureId !== current.captureId) {
        return;
      }
      setLens((previous) => {
        const selectedCount = message.snapshot.selectedCount;
        let phase: LensPhase;
        if (message.snapshot.active) {
          phase = "active";
        } else if (selectedCount > 0) {
          phase =
            previous.phase === "adding" || previous.phase === "ready" ? previous.phase : "ready";
        } else {
          phase = "idle";
        }
        return {
          phase,
          active: message.snapshot.active,
          selectedCount,
          estimatedTokens: message.snapshot.estimatedTokens,
        };
      });
    });
  }, [deps]);

  // 3. Probe for an existing user text selection once the capture is ready.
  useEffect(() => {
    const current = resultRef.current;
    if (current === null || !ready) {
      return;
    }
    let cancelled = false;
    void deps.lens
      .probeSelection(current.tabId, sessionOf(current))
      .then((response) => {
        if (!cancelled && response.ok) {
          setSelectionAvailable(response.hasSelection === true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, ready, captureId]);

  // 4. Derived workbench outputs.
  const outputs = useMemo<WorkbenchOutputs | null>(() => {
    if (!ready || candidate === null) {
      return null;
    }
    return deriveWorkbenchOutputs({ cart, candidate, selectedRecipe });
  }, [ready, cart, candidate, selectedRecipe]);

  async function addCaptureToCart(): Promise<void> {
    const current = resultRef.current;
    const item = candidate;
    if (current === null || item === null || !ready) {
      return;
    }
    const outcome = addCandidateToCart(cart, item);
    if (outcome.status === "added") {
      applyCart(outcome.cart);
      notice("Added to Context.", "success");
    } else if (outcome.status === "duplicate") {
      notice("This source is already in Context Cart.", "info");
    } else {
      notice("Context Cart is full. Remove a source first.", "error");
    }
  }

  const pickOnPage = useCallback(async (): Promise<void> => {
    const current = resultRef.current;
    if (current === null || !ready) {
      return;
    }
    setLens({ ...IDLE_LENS, phase: "entering", active: true });
    const response = await deps.lens.enter(current.tabId, sessionOf(current));
    if (response.ok && response.snapshot !== undefined) {
      setLens({
        phase: "active",
        active: response.snapshot.active,
        selectedCount: response.snapshot.selectedCount,
        estimatedTokens: response.snapshot.estimatedTokens,
      });
      notice("Lens is on — click page areas to include them, then press Done in the dock.", "info");
    } else {
      setLens(IDLE_LENS);
      notice(errorMessage(response.error), "error");
    }
  }, [deps, ready, notice, sessionOf]);

  function fragmentItem(
    document: NormalizedDocument,
    labels: string[],
    captureId: string,
  ): ContextSourceItem {
    return {
      id: createContextSourceId(),
      captureId,
      url: document.source.url,
      capturedAt: document.metadata.capturedAt,
      title: document.metadata.title,
      sourceKind: document.source.kind,
      adapter: document.capture?.adapter,
      scope: document.capture?.scope ?? "selection",
      selection:
        document.capture?.scope === "full-page"
          ? undefined
          : { regions: Math.max(1, labels.length), labels },
      role: "reference",
      primary: false,
      document,
    };
  }

  async function addPickedSections(): Promise<void> {
    const current = resultRef.current;
    if (current === null || lens.phase !== "ready") {
      return;
    }
    setLens((previous) => ({ ...previous, phase: "adding" }));
    const response = await deps.lens.materialize(current.tabId, sessionOf(current));
    const finish = (): void => {
      setLens(IDLE_LENS);
      void deps.lens.clear(current.tabId, current.captureId).catch(() => undefined);
    };
    if (!response.ok) {
      setLens((previous) => ({ ...previous, phase: "ready" }));
      notice(errorMessage(response.error), "error");
      return;
    }
    const payload = response.materialization;
    if (payload === undefined || payload === null) {
      notice("Select at least one area on the page first.", "info");
      finish();
      return;
    }
    const item = fragmentItem(
      payload.document,
      payload.regions.map((region) => region.label),
      current.captureId,
    );
    const outcome = addCandidateToCart(cart, item);
    if (outcome.status === "added") {
      applyCart(outcome.cart);
      notice(`Added ${payload.regions.length} picked area(s) to Context.`, "success");
      finish();
    } else if (outcome.status === "duplicate") {
      notice("This selection is already in Context Cart.", "info");
      finish();
    } else {
      notice("Context Cart is full. Remove a source first.", "error");
      setLens((previous) => ({ ...previous, phase: "ready" }));
    }
  }

  async function discardPickedSections(): Promise<void> {
    const current = resultRef.current;
    setLens(IDLE_LENS);
    if (current !== null) {
      await deps.lens.clear(current.tabId, current.captureId).catch(() => undefined);
    }
  }

  async function addTextSelection(): Promise<void> {
    const current = resultRef.current;
    if (current === null || selectionAvailable !== true) {
      return;
    }
    const response = await deps.lens.captureSelection(current.tabId, sessionOf(current));
    if (!response.ok) {
      notice(errorMessage(response.error), "error");
      return;
    }
    if (response.document === undefined) {
      notice("Nothing is selected on the page.", "info");
      return;
    }
    const label = selectionLabelForExcerpt(response.excerpt ?? response.document.metadata.title);
    const item = fragmentItem(response.document, [label], current.captureId);
    const outcome = addCandidateToCart(cart, item);
    if (outcome.status === "added") {
      applyCart(outcome.cart);
      setSelectionAvailable(false);
      notice("Added your text selection to Context.", "success");
    } else if (outcome.status === "duplicate") {
      notice("This selection is already in Context Cart.", "info");
    } else {
      notice("Context Cart is full. Remove a source first.", "error");
    }
  }

  function setRecipe(recipe: RecipeId): void {
    setSelectedRecipe(recipe);
  }

  function clearRecipeChoice(): void {
    setSelectedRecipe(null);
  }

  function cartMove(itemId: string, direction: -1 | 1): void {
    const index = cart.items.findIndex((item) => item.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cart.items.length) {
      return;
    }
    const moved = moveContextSource(cart, itemId, target);
    if (moved.status === "moved") {
      applyCart(moved.cart);
    }
  }

  function cartRemove(itemId: string): void {
    const removed = removeContextSource(cart, itemId);
    if (removed.status === "removed") {
      applyCart(removed.cart);
    }
  }

  function cartUndo(): void {
    const restored = undoContextCartChange(cart);
    if (restored.status === "restored") {
      applyCart(restored.cart);
    }
  }

  function cartClear(): void {
    const cleared = clearContextCart(cart);
    applyCart(cleared.cart);
  }

  function cartSetRole(itemId: string, role: ContextRole): void {
    const updated = setContextSourceRole(cart, itemId, role);
    if (updated.status === "role-set") {
      applyCart(updated.cart);
    }
  }

  function cartSetPrimary(itemId: string): void {
    const updated = setPrimaryContextSource(cart, itemId);
    if (updated.status === "primary-set") {
      applyCart(updated.cart);
    }
  }

  return {
    ready,
    cart,
    candidate,
    lens,
    selectionAvailable,
    selectedRecipe,
    outputs,
    feedback,
    dismissFeedback,
    addCaptureToCart,
    addPickedSections,
    discardPickedSections,
    pickOnPage,
    addTextSelection,
    setRecipe,
    clearRecipeChoice,
    cartMove,
    cartRemove,
    cartUndo,
    cartClear,
    cartSetRole,
    cartSetPrimary,
  };
}
