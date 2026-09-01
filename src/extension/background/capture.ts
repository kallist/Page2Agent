/**
 * Service Worker capture orchestration (production runtime).
 *
 * Resolves the active tab, builds PageContext, injects the self-contained
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
  isCaptureRequest,
  isContentCaptureFailure,
  isContentCaptureSuccessEnvelope,
} from "../messaging/runtime-messages";
import type { CaptureFailure, CaptureSuccess } from "../messaging/runtime-messages";
import { isSameCapturedPage } from "../messaging/page-url";
import {
  chromeSessionStorage,
  commitCaptureErrorIfCurrent,
  commitCaptureResultIfCurrent,
} from "../session/session-storage";
import type { SessionStorage } from "../session/session-storage";

export interface TabInfo {
  id?: number;
  url?: string;
  title?: string;
}

export interface CaptureRuntimeDeps {
  queryActiveTab(): Promise<TabInfo>;
  getTab(tabId: number): Promise<TabInfo>;
  injectContentScript(tabId: number): Promise<void>;
  sendMessageToTab(tabId: number, message: unknown): Promise<unknown>;
  storage: SessionStorage;
}

export const chromeCaptureRuntimeDeps: CaptureRuntimeDeps = {
  async queryActiveTab(): Promise<TabInfo> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { id: tab?.id, url: tab?.url, title: tab?.title };
  },
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

export async function handleCaptureRequest(
  message: unknown,
  deps: CaptureRuntimeDeps,
): Promise<CaptureSuccess | CaptureFailure> {
  if (!isCaptureRequest(message)) {
    return {
      type: CAPTURE_FAILURE,
      captureId: "unknown",
      error: failureView(Page2AgentErrorCode.INVALID_MESSAGE),
    };
  }
  const { captureId } = message;

  const tab = await deps.queryActiveTab();
  if (tab.id === undefined || tab.url === undefined || tab.url.length === 0) {
    return failure(deps, captureId, Page2AgentErrorCode.CAPTURE_FAILED);
  }
  if (isRestrictedPageUrl(tab.url)) {
    return failure(deps, captureId, Page2AgentErrorCode.RESTRICTED_PAGE);
  }

  const context: PageContext = {
    captureId,
    tabId: tab.id,
    url: tab.url,
    title: tab.title?.trim() || deterministicTitleFallback(tab.url),
    capturedAt: new Date().toISOString(),
  };
  if (!isPageContext(context)) {
    return failure(deps, captureId, Page2AgentErrorCode.CAPTURE_FAILED);
  }

  try {
    await deps.injectContentScript(tab.id);
  } catch {
    // Injection failures on an already-validated URL are restricted-page class
    // failures (permission/activeTab not granted).
    return failure(deps, captureId, Page2AgentErrorCode.RESTRICTED_PAGE);
  }

  let response: unknown;
  try {
    response = await deps.sendMessageToTab(tab.id, {
      type: CONTENT_CAPTURE_REQUEST,
      context,
    });
  } catch {
    return failure(deps, captureId, Page2AgentErrorCode.CAPTURE_FAILED);
  }

  if (isContentCaptureFailure(response)) {
    await commitErrorSafely(deps, captureId, response.error);
    return { type: CAPTURE_FAILURE, captureId, error: response.error };
  }
  if (!isContentCaptureSuccessEnvelope(response)) {
    const error = failureView(Page2AgentErrorCode.INVALID_MESSAGE);
    await commitErrorSafely(deps, captureId, error);
    return { type: CAPTURE_FAILURE, captureId, error };
  }
  if (!isNormalizedDocument(response.document)) {
    const error = failureView(Page2AgentErrorCode.INVALID_DOCUMENT);
    await commitErrorSafely(deps, captureId, error);
    return { type: CAPTURE_FAILURE, captureId, error };
  }

  // Post-capture navigation check: the tab must still exist on the same page.
  try {
    const currentTab = await deps.getTab(tab.id);
    if (currentTab.id === undefined) {
      return failure(deps, captureId, Page2AgentErrorCode.CAPTURE_FAILED);
    }
    if (!isSameCapturedPage(context.url, currentTab.url ?? "")) {
      return failure(deps, captureId, Page2AgentErrorCode.PAGE_NAVIGATED);
    }
  } catch {
    return failure(deps, captureId, Page2AgentErrorCode.CAPTURE_FAILED);
  }

  try {
    const result = buildCaptureResult(response.document, context);
    await commitCaptureResultIfCurrent(deps.storage, captureId, result);
    return { type: CAPTURE_SUCCESS, captureId, result };
  } catch (error) {
    const safeError = toCaptureErrorView(error);
    await commitErrorSafely(deps, captureId, safeError);
    return { type: CAPTURE_FAILURE, captureId, error: safeError };
  }
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

function failureView(code: Page2AgentErrorCode): CaptureErrorView {
  return { code, message: userSafeMessage(code) };
}

function failure(
  deps: CaptureRuntimeDeps,
  captureId: string,
  code: Page2AgentErrorCode,
): CaptureFailure {
  const error = failureView(code);
  void commitErrorSafely(deps, captureId, error);
  return { type: CAPTURE_FAILURE, captureId, error };
}

async function commitErrorSafely(
  deps: CaptureRuntimeDeps,
  captureId: string,
  error: CaptureErrorView,
): Promise<void> {
  try {
    await commitCaptureErrorIfCurrent(deps.storage, captureId, error);
  } catch {
    // Storage failure must not mask the original error.
  }
}
