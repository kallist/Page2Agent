/**
 * Context Lens content-script controller (V1.1).
 *
 * Handles enter / query / materialize requests for the page this script is
 * injected into, and broadcasts live state events while the lens is active.
 * The controller owns one page-scoped lens engine; a fresh page load (and
 * therefore a fresh content-script instance) starts clean.
 *
 * All page checks are URL-based (same-page guards); the engine itself never
 * mutates the page DOM.
 */
import { Page2AgentErrorCode, userSafeMessage } from "../../../core";
import type { NormalizedDocument } from "../../../core";
import { isSameCapturedPage } from "../../messaging/page-url";
import { toCaptureErrorView } from "../../capture/capture-result";
import type { CaptureErrorView } from "../../capture/capture-result";
import {
  LENS_CLEAR_RESPONSE,
  LENS_ENTER_RESPONSE,
  LENS_MATERIALIZE_RESPONSE,
  LENS_QUERY_RESPONSE,
  LENS_SELECTION_CAPTURE_RESPONSE,
  LENS_SELECTION_PROBE_RESPONSE,
  LENS_STATE_EVENT,
  isLensClearRequest,
  isLensEnterRequest,
  isLensMaterializeRequest,
  isLensQueryRequest,
  isLensSelectionCaptureRequest,
  isLensSelectionProbeRequest,
} from "../../messaging/lens-messages";
import type {
  LensClearResponse,
  LensEnterResponse,
  LensMaterializeResponse,
  LensQueryResponse,
  LensSelectionCaptureResponse,
  LensSelectionProbeResponse,
  LensSnapshot,
  LensSessionRef,
} from "../../messaging/lens-messages";
import { createLensEngine } from "./lens-engine";
import type { LensEngine } from "./lens-engine";
import { materializeLensRegions } from "./lens-materialize";
import { captureUserTextSelection, hasUserTextSelection } from "./user-text-selection";

export interface LensControllerDeps {
  locationHref(): string;
  document: Document;
  window: Window;
  /** Extension broadcast (chrome.runtime.sendMessage in production). */
  broadcast(message: unknown): void;
  createEngine?: () => LensEngine;
}

export interface LensController {
  handle(message: unknown): Promise<unknown>;
}

interface LensState {
  session: LensSessionRef | null;
  engine: LensEngine | null;
}

export function createLensController(deps: LensControllerDeps): LensController {
  const state: LensState = { session: null, engine: null };

  function ensureEngine(session: LensSessionRef): LensEngine {
    if (state.engine === null) {
      state.engine =
        deps.createEngine?.() ??
        createLensEngine({
          document: deps.document,
          window: deps.window,
          onState: (snapshot: LensSnapshot) => {
            if (state.session !== null) {
              deps.broadcast({
                type: LENS_STATE_EVENT,
                captureId: state.session.captureId,
                snapshot,
              });
            }
          },
        });
    }
    state.session = session;
    return state.engine;
  }

  function snapshot(): LensSnapshot {
    if (state.engine === null) {
      return { active: false, selectedCount: 0, estimatedTokens: 0 };
    }
    return state.engine.snapshot();
  }

  function pageMatches(session: LensSessionRef): boolean {
    return isSameCapturedPage(session.url, deps.locationHref());
  }

  function errorView(code: Page2AgentErrorCode): CaptureErrorView {
    return { code, message: userSafeMessage(code) };
  }

  async function handle(message: unknown): Promise<unknown> {
    if (isLensEnterRequest(message)) {
      return handleEnter(message.session);
    }
    if (isLensQueryRequest(message)) {
      return handleQuery(message.captureId);
    }
    if (isLensMaterializeRequest(message)) {
      return handleMaterialize(message.session);
    }
    if (isLensClearRequest(message)) {
      return handleClear(message.captureId);
    }
    if (isLensSelectionProbeRequest(message)) {
      return handleSelectionProbe(message.session);
    }
    if (isLensSelectionCaptureRequest(message)) {
      return handleSelectionCapture(message.session);
    }
    return null;
  }

  function handleEnter(session: LensSessionRef): LensEnterResponse {
    if (!pageMatches(session)) {
      return {
        type: LENS_ENTER_RESPONSE,
        captureId: session.captureId,
        ok: false,
        error: errorView(Page2AgentErrorCode.PAGE_NAVIGATED),
      };
    }
    if (!isLensEligibleUrl(deps.locationHref())) {
      return {
        type: LENS_ENTER_RESPONSE,
        captureId: session.captureId,
        ok: false,
        error: errorView(Page2AgentErrorCode.RESTRICTED_PAGE),
      };
    }
    try {
      const engine = ensureEngine(session);
      engine.activate();
      return {
        type: LENS_ENTER_RESPONSE,
        captureId: session.captureId,
        ok: true,
        snapshot: engine.snapshot(),
      };
    } catch {
      return {
        type: LENS_ENTER_RESPONSE,
        captureId: session.captureId,
        ok: false,
        error: errorView(Page2AgentErrorCode.CAPTURE_FAILED),
      };
    }
  }

  function handleQuery(captureId: string): LensQueryResponse {
    const current = state.session;
    if (current === null || current.captureId !== captureId) {
      return { type: LENS_QUERY_RESPONSE, captureId, ok: false, error: errorView(Page2AgentErrorCode.NO_CONTENT_FOUND) };
    }
    return {
      type: LENS_QUERY_RESPONSE,
      captureId,
      ok: true,
      snapshot: snapshot(),
    };
  }

  function handleMaterialize(session: LensSessionRef): LensMaterializeResponse {
    if (state.session === null || state.session.captureId !== session.captureId) {
      return {
        type: LENS_MATERIALIZE_RESPONSE,
        captureId: session.captureId,
        ok: false,
        error: errorView(Page2AgentErrorCode.NO_CONTENT_FOUND),
      };
    }
    if (!pageMatches(session)) {
      return {
        type: LENS_MATERIALIZE_RESPONSE,
        captureId: session.captureId,
        ok: false,
        error: errorView(Page2AgentErrorCode.PAGE_NAVIGATED),
      };
    }
    const engine = state.engine;
    if (engine === null || engine.selectedRegions().length === 0) {
      return { type: LENS_MATERIALIZE_RESPONSE, captureId: session.captureId, ok: true };
    }
    try {
      const result = materializeLensRegions({
        session: {
          captureId: session.captureId,
          url: session.url,
          capturedAt: session.capturedAt,
        },
        regions: engine.selectedRegions(),
      });
      if (result === null) {
        return { type: LENS_MATERIALIZE_RESPONSE, captureId: session.captureId, ok: true };
      }
      return {
        type: LENS_MATERIALIZE_RESPONSE,
        captureId: session.captureId,
        ok: true,
        materialization: { document: result.document, regions: result.regions },
      };
    } catch (error) {
      return {
        type: LENS_MATERIALIZE_RESPONSE,
        captureId: session.captureId,
        ok: false,
        error: toCaptureErrorView(error),
      };
    }
  }

  function handleClear(captureId: string): LensClearResponse {
    if (state.session === null || state.session.captureId !== captureId) {
      return { type: LENS_CLEAR_RESPONSE, captureId, ok: false, error: errorView(Page2AgentErrorCode.NO_CONTENT_FOUND) };
    }
    if (state.engine !== null) {
      state.engine.clearSelections();
    }
    return lensClearResult(captureId);
  }

  function handleSelectionProbe(session: LensSessionRef): LensSelectionProbeResponse {
    if (!pageMatches(session)) {
      return { type: LENS_SELECTION_PROBE_RESPONSE, captureId: session.captureId, ok: false, error: errorView(Page2AgentErrorCode.PAGE_NAVIGATED) };
    }
    return lensProbeResult(session.captureId, hasUserTextSelection({ window: deps.window }));
  }

  function handleSelectionCapture(session: LensSessionRef): LensSelectionCaptureResponse {
    if (!pageMatches(session)) {
      return selectionError(session.captureId, errorView(Page2AgentErrorCode.PAGE_NAVIGATED));
    }
    if (!hasUserTextSelection({ window: deps.window })) {
      return selectionError(session.captureId, errorView(Page2AgentErrorCode.NO_CONTENT_FOUND));
    }
    try {
      const result = captureUserTextSelection(
        { window: deps.window },
        {
          captureId: session.captureId,
          url: session.url,
          capturedAt: session.capturedAt,
          pageTitle: deps.document.title,
        },
      );
      return lensSelectionResult(session.captureId, result.document, result.excerpt);
    } catch (error) {
      return selectionError(session.captureId, toCaptureErrorView(error));
    }
  }

  return { handle };
}

/** Drop retained picks after they were handed off (or user discards them). */
function lensClearResult(captureId: string): LensClearResponse {
  return { type: LENS_CLEAR_RESPONSE, captureId, ok: true };
}

function lensProbeResult(
  captureId: string,
  hasSelection: boolean,
): LensSelectionProbeResponse {
  return { type: LENS_SELECTION_PROBE_RESPONSE, captureId, ok: true, hasSelection };
}

function lensSelectionResult(
  captureId: string,
  document: NormalizedDocument,
  excerpt?: string,
): LensSelectionCaptureResponse {
  return {
    type: LENS_SELECTION_CAPTURE_RESPONSE,
    captureId,
    ok: true,
    document,
    ...(excerpt !== undefined ? { excerpt } : {}),
  };
}

function selectionError(captureId: string, error: CaptureErrorView): LensSelectionCaptureResponse {
  return { type: LENS_SELECTION_CAPTURE_RESPONSE, captureId, ok: false, error };
}

/** Contexts the lens must not run in (browser-internal schemes only). */
export function isLensEligibleUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
