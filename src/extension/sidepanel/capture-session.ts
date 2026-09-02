/**
 * Read-only Side Panel capture session.
 *
 * Production capture intent is owned by the toolbar action in the Service
 * Worker. The panel only restores and follows its browser window's state; it
 * cannot mint an activeTab grant or switch the capture target.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isCaptureIntentStale,
  isLatestCaptureIntent,
  isCaptureOutcome,
  latestCaptureIntentKey,
} from "../session/session-state";
import { chromeSessionStorage, readCaptureOutcome } from "../session/session-storage";
import { Page2AgentErrorCode } from "../../core";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

export type CaptureViewState =
  | { status: "idle" }
  | { status: "capturing"; captureId: string }
  | { status: "captured"; captureId: string; result: CaptureResult }
  | { status: "error"; captureId: string; error: CaptureErrorView };

export interface CaptureSessionDeps {
  readIntent(): Promise<unknown>;
  readOutcome(captureId: string): Promise<unknown>;
  subscribeSessionChanges(listener: () => void): () => void;
  now(): string;
}

export interface CaptureSessionController {
  view: CaptureViewState;
}

export const INTERRUPTED_CAPTURE_MESSAGE =
  "Previous capture was interrupted. Click the Page2Agent toolbar icon to try again.";

export function useCaptureSession(deps: CaptureSessionDeps): CaptureSessionController {
  const [view, setView] = useState<CaptureViewState>({ status: "idle" });
  const restoreSequence = useRef(0);

  const restoreFromStorage = useCallback(async (): Promise<void> => {
    const sequence = ++restoreSequence.current;
    const rawIntent = await deps.readIntent();
    if (sequence !== restoreSequence.current) {
      return;
    }
    if (!isLatestCaptureIntent(rawIntent)) {
      setView({ status: "idle" });
      return;
    }
    const intent = rawIntent;

    const rawOutcome = await deps.readOutcome(intent.captureId);
    if (sequence !== restoreSequence.current) {
      return;
    }
    if (isCaptureOutcome(rawOutcome)) {
      if (rawOutcome.status === "captured") {
        setView({ status: "captured", captureId: intent.captureId, result: rawOutcome.result });
      } else {
        setView({ status: "error", captureId: intent.captureId, error: rawOutcome.error });
      }
      return;
    }

    if (isCaptureIntentStale(intent, deps.now())) {
      setView({
        status: "error",
        captureId: intent.captureId,
        error: {
          code: Page2AgentErrorCode.CAPTURE_FAILED,
          message: INTERRUPTED_CAPTURE_MESSAGE,
        },
      });
      return;
    }
    setView({ status: "capturing", captureId: intent.captureId });
  }, [deps]);

  useEffect(() => {
    queueMicrotask(() => {
      void restoreFromStorage();
    });
  }, [restoreFromStorage]);

  useEffect(() => {
    return deps.subscribeSessionChanges(() => {
      void restoreFromStorage();
    });
  }, [deps, restoreFromStorage]);

  return { view };
}

/** Resolve one stable window namespace; no tabs permission is required. */
export function createProductionSessionDeps(): CaptureSessionDeps {
  const windowIdPromise = chrome.windows.getCurrent().then((browserWindow) => {
    const windowId = browserWindow.id;
    if (windowId === undefined || !Number.isSafeInteger(windowId) || windowId < 0) {
      throw new Error("The Side Panel browser window could not be resolved.");
    }
    return windowId;
  });
  const intentKeyPromise = windowIdPromise.then(latestCaptureIntentKey);
  return {
    readIntent: async () => chromeSessionStorage.get(await intentKeyPromise),
    readOutcome: (captureId: string) => readCaptureOutcome(chromeSessionStorage, captureId),
    subscribeSessionChanges: (listener: () => void) => {
      const handler = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ): void => {
        if (areaName === "session" && Object.keys(changes).length > 0) {
          listener();
        }
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
    now: () => new Date().toISOString(),
  };
}
