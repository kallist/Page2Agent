/**
 * Side Panel capture session controller (TASK 08 ownership model).
 *
 * The Side Panel OWNS the latest capture intent:
 *  - intent writes are serialized through a queue so durable intent order
 *    always matches the user click order,
 *  - the local latestCaptureIdRef gate immediately ignores stale responses,
 *  - restore reads only the latest intent's per-capture outcome.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTURE_REQUEST, isCaptureFailure, isCaptureSuccess } from "../messaging/runtime-messages";
import {
  isCaptureIntentStale,
  LATEST_CAPTURE_KEY,
  isLatestCaptureIntent,
  isCaptureOutcome,
} from "../session/session-state";
import type { LatestCaptureIntent } from "../session/session-state";
import { chromeSessionStorage, createSerializedIntentWriter, readCaptureOutcome, removeAllOutcomes } from "../session/session-storage";
import type { IntentWriter } from "../session/session-storage";
import { Page2AgentErrorCode, userSafeMessage } from "../../core";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";

export type CaptureViewState =
  | { status: "idle" }
  | { status: "capturing"; captureId: string }
  | { status: "captured"; captureId: string; result: CaptureResult }
  | { status: "error"; captureId: string; error: CaptureErrorView };

export interface CaptureSessionDeps {
  sendCaptureRequest(captureId: string): Promise<unknown>;
  readIntent(): Promise<unknown>;
  writeIntent(intent: LatestCaptureIntent): Promise<void>;
  readOutcome(captureId: string): Promise<unknown>;
  cleanupOutcomes(): Promise<void>;
  subscribeSessionChanges(listener: () => void): () => void;
  now(): string;
  createCaptureId(): string;
}

export interface CaptureSessionController {
  view: CaptureViewState;
  capture(): Promise<void>;
}

export const INTERRUPTED_CAPTURE_MESSAGE = "Previous capture was interrupted. Capture the page again.";

export function useCaptureSession(deps: CaptureSessionDeps): CaptureSessionController {
  const [view, setView] = useState<CaptureViewState>({ status: "idle" });
  const latestIdRef = useRef<string | null>(null);
  const intentWriterRef = useRef<IntentWriter | null>(null);

  if (intentWriterRef.current === null) {
    // Serialized intent writes: click order == durable order.
    intentWriterRef.current = createSerializedIntentWriter(async (intent) => {
      await deps.cleanupOutcomes();
      await deps.writeIntent(intent);
    });
  }

  const restoreFromStorage = useCallback(async (): Promise<void> => {
    const rawIntent = await deps.readIntent();
    if (!isLatestCaptureIntent(rawIntent)) {
      setView({ status: "idle" });
      return;
    }
    const intent = rawIntent;
    latestIdRef.current = intent.captureId;

    const rawOutcome = await deps.readOutcome(intent.captureId);
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
    // Fresh intent with no outcome yet: still in flight (or worker restarted).
    setView({ status: "capturing", captureId: intent.captureId });
  }, [deps]);

  // Restore on mount and follow session changes (worker outcomes, intent writes).
  // Deferred off the synchronous effect body to avoid direct setState in the
  // effect (react-hooks rule) — the restore is inherently asynchronous anyway.
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

  const capture = useCallback(async (): Promise<void> => {
    const captureId = deps.createCaptureId();
    latestIdRef.current = captureId;
    setView({ status: "capturing", captureId });

    const intent: LatestCaptureIntent = {
      schemaVersion: 1,
      captureId,
      startedAt: deps.now(),
    };
    try {
      await intentWriterRef.current?.writeIntent(intent);
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

    // Local response gate: only the latest capture may update the UI.
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
    readIntent: () => chromeSessionStorage.get(LATEST_CAPTURE_KEY),
    writeIntent: (intent: LatestCaptureIntent) =>
      chromeSessionStorage.set(LATEST_CAPTURE_KEY, intent),
    readOutcome: (captureId: string) => readCaptureOutcome(chromeSessionStorage, captureId),
    cleanupOutcomes: () => removeAllOutcomes(chromeSessionStorage),
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
    createCaptureId: () => crypto.randomUUID(),
  };
}
