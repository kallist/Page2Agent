/**
 * Service Worker capture orchestration (production runtime).
 *
 * Receives the exact action-clicked tab, builds PageContext, injects the self-contained
 * content script, correlates the validated NormalizedDocument, re-checks page
 * navigation, packages + serializes in the worker, and commits the final
 * CaptureResult through the latest-capture-wins session gate.
 *
 * The Service Worker never touches the DOM and keeps no durable in-memory
 * capture state (MV3 lifecycle safe). All Chrome access goes through the
 * injected dependency object so tests use fakes.
 */
import { buildAgentPackage, serializeAgentPackage } from "../../application";
import { buildMarkdownFilename } from "../../application/delivery";
import {
  countDocumentCharacters,
  isNormalizedDocument,
  isPageContext,
  isRestrictedPageUrl,
  Page2AgentErrorCode,
  userSafeMessage,
} from "../../core";
import type { NormalizedDocument, PageContext } from "../../core";
import { serializeNormalizedDocument } from "../../core/serialize";
import { isCaptureResult, toCaptureErrorView } from "../capture/capture-result";
import type { CaptureErrorView, CaptureResult } from "../capture/capture-result";
import {
  CAPTURE_FAILURE,
  CAPTURE_SUCCESS,
  CONTENT_CAPTURE_REQUEST,
  isContentCaptureFailure,
  isContentCaptureSuccessEnvelope,
} from "../messaging/runtime-messages";
import type { CaptureFailure, CaptureSuccess } from "../messaging/runtime-messages";
import { isSameCapturedPage } from "../messaging/page-url";
import {
  chromeSessionStorage,
  readLatestIntent,
  removeCaptureOutcome,
  writeCaptureOutcome,
} from "../session/session-storage";
import type { SessionStorage } from "../session/session-storage";
import type { CaptureOutcome } from "../session/session-state";
import { writeWindowDocument } from "../session/document-cache";

export interface TabInfo {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
}

export interface CaptureTarget {
  id: number;
  windowId: number;
  url: string;
  title?: string;
}

export interface CaptureRuntimeDeps {
  getTab(tabId: number): Promise<TabInfo>;
  injectContentScript(tabId: number): Promise<void>;
  sendMessageToTab(tabId: number, message: unknown): Promise<unknown>;
  storage: SessionStorage;
}

export const chromeCaptureRuntimeDeps: CaptureRuntimeDeps = {
  async getTab(tabId: number): Promise<TabInfo> {
    const tab = await chrome.tabs.get(tabId);
    return { id: tab.id, url: tab.url, title: tab.title };
  },
  async injectContentScript(tabId: number): Promise<void> {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["assets/content-script.js"],
    });
  },
  async sendMessageToTab(tabId: number, message: unknown): Promise<unknown> {
    return chrome.tabs.sendMessage(tabId, message);
  },
  storage: chromeSessionStorage,
};

export async function captureExactTab(
  captureId: string,
  target: unknown,
  deps: CaptureRuntimeDeps,
): Promise<CaptureSuccess | CaptureFailure> {
  if (typeof captureId !== "string" || captureId.length === 0 || !isCaptureTarget(target)) {
    return {
      type: CAPTURE_FAILURE,
      captureId: typeof captureId === "string" && captureId.length > 0 ? captureId : "unknown",
      error: failureView(Page2AgentErrorCode.INVALID_MESSAGE),
    };
  }
  const { windowId } = target;

  if (isRestrictedPageUrl(target.url)) {
    return await failure(deps, captureId, windowId, Page2AgentErrorCode.RESTRICTED_PAGE);
  }

  const context: PageContext = {
    captureId,
    tabId: target.id,
    url: target.url,
    title: target.title?.trim() || deterministicTitleFallback(target.url),
    capturedAt: new Date().toISOString(),
  };
  if (!isPageContext(context)) {
    return await failure(deps, captureId, windowId, Page2AgentErrorCode.CAPTURE_FAILED);
  }

  try {
    await deps.injectContentScript(target.id);
  } catch {
    // Injection failures on an already-validated URL are restricted-page class
    // failures (permission/activeTab not granted).
    return await failure(deps, captureId, windowId, Page2AgentErrorCode.RESTRICTED_PAGE);
  }

  let response: unknown;
  try {
    response = await deps.sendMessageToTab(target.id, {
      type: CONTENT_CAPTURE_REQUEST,
      context,
    });
  } catch {
    return await failure(deps, captureId, windowId, Page2AgentErrorCode.CAPTURE_FAILED);
  }

  if (isContentCaptureFailure(response)) {
    if (response.captureId !== captureId) {
      return await failure(deps, captureId, windowId, Page2AgentErrorCode.INVALID_MESSAGE);
    }
    await writeOutcomeSafely(deps, windowId, { schemaVersion: 1, status: "error", captureId, error: response.error });
    return { type: CAPTURE_FAILURE, captureId, error: response.error };
  }
  if (!isContentCaptureSuccessEnvelope(response)) {
    const error = failureView(Page2AgentErrorCode.INVALID_MESSAGE);
    await writeOutcomeSafely(deps, windowId, { schemaVersion: 1, status: "error", captureId, error });
    return { type: CAPTURE_FAILURE, captureId, error };
  }
  if (response.captureId !== captureId) {
    return await failure(deps, captureId, windowId, Page2AgentErrorCode.INVALID_MESSAGE);
  }
  if (!isNormalizedDocument(response.document)) {
    const error = failureView(Page2AgentErrorCode.INVALID_DOCUMENT);
    await writeOutcomeSafely(deps, windowId, { schemaVersion: 1, status: "error", captureId, error });
    return { type: CAPTURE_FAILURE, captureId, error };
  }

  // Post-capture navigation check: the tab must still exist on the same page.
  try {
    const currentTab = await deps.getTab(target.id);
    if (currentTab.id === undefined) {
      return await failure(deps, captureId, windowId, Page2AgentErrorCode.CAPTURE_FAILED);
    }
    if (!isSameCapturedPage(context.url, currentTab.url ?? "")) {
      return await failure(deps, captureId, windowId, Page2AgentErrorCode.PAGE_NAVIGATED);
    }
  } catch {
    return await failure(deps, captureId, windowId, Page2AgentErrorCode.CAPTURE_FAILED);
  }

  try {
    const result = buildCaptureResult(response.document, context);
    // Ownership model: the worker writes ONLY its own per-capture outcome key.
    // The latest intent key is owned by the action controller and is never
    // touched here, so a stale capture can never revert the latest intent.
    const outcomeWritten = await writeOutcomeSafely(deps, windowId, {
      schemaVersion: 1,
      status: "captured",
      captureId,
      result,
    });
    if (!outcomeWritten) {
      const error = failureView(Page2AgentErrorCode.CAPTURE_FAILED);
      return { type: CAPTURE_FAILURE, captureId, error };
    }
    // V1.1: cache the structured document for THIS window so the panel can
    // add the capture to the Context Cart. Session-only, one record per
    // window; a cache failure never fails the capture itself.
    await cacheWindowDocumentSafely(deps, windowId, captureId, response.document);
    return { type: CAPTURE_SUCCESS, captureId, result };
  } catch (error) {
    const safeError = toCaptureErrorView(error);
    await writeOutcomeSafely(deps, windowId, { schemaVersion: 1, status: "error", captureId, error: safeError });
    return { type: CAPTURE_FAILURE, captureId, error: safeError };
  }
}

export function isCaptureTarget(value: unknown): value is CaptureTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set(["id", "windowId", "url", "title"]);
  return (
    Object.keys(candidate).every((key) => allowed.has(key)) &&
    typeof candidate.id === "number" &&
    Number.isSafeInteger(candidate.id) &&
    candidate.id >= 0 &&
    typeof candidate.windowId === "number" &&
    Number.isSafeInteger(candidate.windowId) &&
    candidate.windowId >= 0 &&
    typeof candidate.url === "string" &&
    candidate.url.length > 0 &&
    (candidate.title === undefined || typeof candidate.title === "string")
  );
}

function buildCaptureResult(
  document: NormalizedDocument,
  context: PageContext,
): CaptureResult {
  const agentPackage = buildAgentPackage(document);
  const result: CaptureResult = {
    schemaVersion: 1,
    captureId: context.captureId,
    tabId: context.tabId,
    url: context.url,
    capturedAt: context.capturedAt,
    sourceKind: document.source.kind,
    title: document.metadata.title,
    actionKind: agentPackage.task.kind === "context" ? "use_as_context" : "fix_issue",
    stats: {
      characters: countDocumentCharacters(document),
      codeBlocks: document.blocks.filter((block) => block.type === "code").length,
      links: document.blocks.filter((block) => block.type === "link").length,
    },
    markdown: serializeNormalizedDocument(document),
    agentContext: serializeAgentPackage(agentPackage),
    filename: buildMarkdownFilename(document),
  };
  if (!isCaptureResult(result)) {
    throw new Error("CaptureResult construction produced an invalid result");
  }
  return result;
}

function deterministicTitleFallback(url: string): string {
  try {
    return new URL(url).hostname || "page";
  } catch {
    return "page";
  }
}

/**
 * Best-effort V1.1 document cache write. Failure is hygiene-only: the
 * capture result itself is already committed at this point.
 */
async function cacheWindowDocumentSafely(
  deps: CaptureRuntimeDeps,
  windowId: number,
  captureId: string,
  document: NormalizedDocument,
): Promise<void> {
  try {
    await writeWindowDocument(deps.storage, windowId, {
      schemaVersion: 1,
      captureId,
      document,
    });
  } catch {
    // ignore: cache write failures never fail the capture
  }
}

function failureView(code: Page2AgentErrorCode): CaptureErrorView {
  return { code, message: userSafeMessage(code) };
}

async function failure(
  deps: CaptureRuntimeDeps,
  captureId: string,
  windowId: number,
  code: Page2AgentErrorCode,
): Promise<CaptureFailure> {
  const error = failureView(code);
  await writeOutcomeSafely(deps, windowId, { schemaVersion: 1, status: "error", captureId, error });
  return { type: CAPTURE_FAILURE, captureId, error };
}

/**
 * Write this capture's outcome to its own per-capture key. Returns false when
 * the storage write fails (the panel then sees CAPTURE_FAILED and the restore
 * path stays recoverable).
 */
async function writeOutcomeSafely(
  deps: CaptureRuntimeDeps,
  windowId: number,
  outcome: CaptureOutcome,
): Promise<boolean> {
  try {
    await writeCaptureOutcome(deps.storage, outcome);
  } catch {
    return false;
  }

  // A stale capture can finish after the action controller advanced the
  // intent. Re-check the read-only intent after writing and delete only this
  // capture's now-orphaned outcome. The Side Panel independently rejects stale
  // async restores; this step bounds session-only page content.
  try {
    const latestIntent = await readLatestIntent(deps.storage, windowId);
    if (latestIntent !== null && latestIntent.captureId !== outcome.captureId) {
      await removeCaptureOutcome(deps.storage, outcome.captureId);
    }
  } catch {
    // Hygiene only. A cleanup/read failure must not change the response.
  }
  return true;
}
