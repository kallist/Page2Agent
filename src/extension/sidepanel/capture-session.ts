/**
 * Side Panel capture session controller.
 *
 * Latest-capture-wins lives here too:
 *  - the panel writes the capturing marker to chrome.storage.session BEFORE
 *    sending capture.request (user click order is the source of truth),
 *  - responses are accepted only when their captureId still matches the local
 *    latest id (double protection with the worker's compare-before-write).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTURE_REQUEST, isCaptureFailure, isCaptureSuccess } from "../messaging/runtime-messages";
import { CAPTURE_SESSION_KEY, isCaptureSessionState } from "../session/session-state";
import type { CaptureSessionState } from "../session/session-state";
import { Page2AgentErrorCode, userSafeMessage } from "../../core";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

export type CaptureViewState =
  | { status: "idle" }
  | { status: "capturing"; captureId: string }
  | { status: "captured"; captureId: string; result: CaptureResult }
  | { status: "error"; captureId: string; error: CaptureErrorView };

export interface CaptureSessionDeps {
  sendCaptureRequest(captureId: string): Promise<unknown>;
  readSession(): Promise<unknown>;
  writeSession(value: CaptureSessionState): Promise<void>;
  subscribeSessionChanges(listener: () => void): () => void;
  now(): string;
  createCaptureId(): string;
}

export interface CaptureSessionController {
  view: CaptureViewState;
  capture(): Promise<void>;
}

export function useCaptureSession(deps: CaptureSessionDeps): CaptureSessionController {
  const [view, setView] = useState<CaptureViewState>({ status: "idle" });
  const latestIdRef = useRef<string | null>(null);

  const applySessionState = useCallback((raw: unknown): void => {
    const state = isCaptureSessionState(raw) ? raw : null;
    if (state === null) {
      setView({ status: "idle" });
      return;
    }
    latestIdRef.current = state.captureId;
    if (state.status === "captured") {
      setView({ status: "captured", captureId: state.captureId, result: state.result });
    } else if (state.status === "error") {
      setView({ status: "error", captureId: state.captureId, error: state.error });
    } else {
      setView({ status: "capturing", captureId: state.captureId });
    }
  }, []);

  // Restore the session on mount.
  useEffect(() => {
    let cancelled = false;
    void deps.readSession().then((raw) => {
      if (!cancelled) {
        applySessionState(raw);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [deps, applySessionState]);

  // Follow worker commits (e.g. when the panel re-opened during capturing).
  useEffect(() => {
    return deps.subscribeSessionChanges(() => {
      void deps.readSession().then(applySessionState);
    });
  }, [deps, applySessionState]);

  const capture = useCallback(async (): Promise<void> => {
    const captureId = deps.createCaptureId();
    latestIdRef.current = captureId;
    setView({ status: "capturing", captureId });

    try {
      await deps.writeSession({
        schemaVersion: 1,
        status: "capturing",
        captureId,
        startedAt: deps.now(),
      });
    } catch {
      setView({
        status: "error",
        captureId,
        error: {
          code: Page2AgentErrorCode.CAPTURE_FAILED,
          message: userSafeMessage(Page2AgentErrorCode.CAPTURE_FAILED),
        },
      });
      return;
    }

    let response: unknown;
    try {
      response = await deps.sendCaptureRequest(captureId);
    } catch {
      // Service Worker unreachable or channel failure.
      setView({
        status: "error",
        captureId,
        error: {
          code: Page2AgentErrorCode.CAPTURE_FAILED,
          message: userSafeMessage(Page2AgentErrorCode.CAPTURE_FAILED),
        },
      });
      return;
    }

    // Response gate: only the latest capture may update the UI.
    if (latestIdRef.current !== captureId) {
      return;
    }
    if (isCaptureSuccess(response) && response.captureId === captureId) {
      setView({ status: "captured", captureId, result: response.result });
      return;
    }
    if (isCaptureFailure(response) && response.captureId === captureId) {
      setView({ status: "error", captureId, error: response.error });
      return;
    }
    setView({
      status: "error",
      captureId,
      error: {
        code: Page2AgentErrorCode.INVALID_MESSAGE,
        message: userSafeMessage(Page2AgentErrorCode.INVALID_MESSAGE),
      },
    });
  }, [deps]);

  return { view, capture };
}

/** Production dependency wiring (chrome runtime + chrome.storage.session). */
export function createProductionSessionDeps(): CaptureSessionDeps {
  return {
    sendCaptureRequest: (captureId: string) =>
      chrome.runtime.sendMessage({ type: CAPTURE_REQUEST, captureId }),
    readSession: async () => {
      const data = await chrome.storage.session.get(CAPTURE_SESSION_KEY);
      return data[CAPTURE_SESSION_KEY];
    },
    writeSession: (value: CaptureSessionState) =>
      chrome.storage.session.set({ [CAPTURE_SESSION_KEY]: value }),
    subscribeSessionChanges: (listener: () => void) => {
      const handler = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ): void => {
        if (areaName === "session" && CAPTURE_SESSION_KEY in changes) {
          listener();
        }
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
    now: () => new Date().toISOString(),
    createCaptureId: () => crypto.randomUUID(),
  };
}
