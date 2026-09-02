/**
 * Toolbar-action capture entrypoint.
 *
 * The chrome.action callback is the permission-bearing user gesture. Its tab
 * argument is therefore the only production capture target: no later active
 * tab query is allowed to guess a different page.
 */
import { Page2AgentErrorCode, userSafeMessage } from "../../core";
import type { CaptureFailure, CaptureSuccess } from "../messaging/runtime-messages";
import {
  latestCaptureIntentKey,
} from "../session/session-state";
import type { LatestCaptureIntent } from "../session/session-state";
import {
  readLatestIntent,
  removeCaptureOutcome,
  writeCaptureOutcome,
} from "../session/session-storage";
import type { SessionStorage } from "../session/session-storage";
import type { CaptureTarget } from "./capture";

export interface ActionCaptureDeps {
  storage: SessionStorage;
  openSidePanel(windowId: number): Promise<void>;
  capture(captureId: string, target: CaptureTarget): Promise<CaptureSuccess | CaptureFailure>;
  createCaptureId(): string;
  now(): string;
}

export type ActionClickHandler = (tab: unknown) => Promise<CaptureSuccess | CaptureFailure>;

/**
 * One handler instance lives for one Service Worker lifetime. The queue only
 * orders overlapping intent writes; durable intent/outcome truth remains in
 * chrome.storage.session and never depends on this closure surviving restart.
 */
export function createActionClickHandler(deps: ActionCaptureDeps): ActionClickHandler {
  const intentWriteQueues = new Map<number, Promise<void>>();

  return async (tab: unknown): Promise<CaptureSuccess | CaptureFailure> => {
    const windowId = readWindowId(tab);
    if (windowId === null) {
      return invalidActionFailure("unknown");
    }

    // Invoke open() before the first await so it remains in the action's user
    // gesture path. Capture continues even if Chrome cannot display the panel.
    void deps.openSidePanel(windowId).catch(() => undefined);

    const captureId = deps.createCaptureId();
    const intent: LatestCaptureIntent = {
      schemaVersion: 1,
      captureId,
      startedAt: deps.now(),
    };

    const priorIntentWrite = intentWriteQueues.get(windowId) ?? Promise.resolve();
    const intentWrite = priorIntentWrite.then(async () => {
      const previous = await readLatestIntent(deps.storage, windowId);
      await deps.storage.set(latestCaptureIntentKey(windowId), intent);
      if (previous !== null && previous.captureId !== captureId) {
        try {
          await removeCaptureOutcome(deps.storage, previous.captureId);
        } catch {
          // Outcome cleanup is bounded hygiene, never capture correctness.
        }
      }
    });
    const queueTail = intentWrite.catch(() => undefined);
    intentWriteQueues.set(windowId, queueTail);
    void queueTail.then(() => {
      if (intentWriteQueues.get(windowId) === queueTail) {
        intentWriteQueues.delete(windowId);
      }
    });

    try {
      await intentWrite;
    } catch {
      return captureFailure(captureId, Page2AgentErrorCode.CAPTURE_FAILED);
    }

    const target = toCaptureTarget(tab);
    if (target === null) {
      const response = invalidActionFailure(captureId);
      try {
        await writeCaptureOutcome(deps.storage, {
          schemaVersion: 1,
          status: "error",
          captureId,
          error: response.error,
        });
      } catch {
        // The safe response is still returned when session persistence fails.
      }
      return response;
    }

    return deps.capture(captureId, target);
  };
}

function toCaptureTarget(tab: unknown): CaptureTarget | null {
  if (typeof tab !== "object" || tab === null || Array.isArray(tab)) {
    return null;
  }
  const candidate = tab as Record<string, unknown>;
  if (
    typeof candidate.id !== "number" ||
    !Number.isSafeInteger(candidate.id) ||
    candidate.id < 0 ||
    typeof candidate.windowId !== "number" ||
    !Number.isSafeInteger(candidate.windowId) ||
    candidate.windowId < 0 ||
    typeof candidate.url !== "string" ||
    candidate.url.length === 0 ||
    (candidate.title !== undefined && typeof candidate.title !== "string")
  ) {
    return null;
  }
  return {
    id: candidate.id,
    windowId: candidate.windowId,
    url: candidate.url,
    ...(candidate.title === undefined ? {} : { title: candidate.title }),
  };
}

function readWindowId(tab: unknown): number | null {
  if (typeof tab !== "object" || tab === null || Array.isArray(tab)) {
    return null;
  }
  const windowId = (tab as Record<string, unknown>).windowId;
  return typeof windowId === "number" && Number.isSafeInteger(windowId) && windowId >= 0
    ? windowId
    : null;
}

function invalidActionFailure(captureId: string): CaptureFailure {
  return captureFailure(captureId, Page2AgentErrorCode.INVALID_MESSAGE);
}

function captureFailure(
  captureId: string,
  code: Page2AgentErrorCode,
): CaptureFailure {
  return {
    type: "capture.failure",
    captureId,
    error: { code, message: userSafeMessage(code) },
  };
}
