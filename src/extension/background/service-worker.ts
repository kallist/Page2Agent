/**
 * MV3 Service Worker — extension orchestration foundation (TASK 02).
 *
 * Responsibilities (only):
 *  1. Configure Side Panel action behavior.
 *  2. Receive validated foundation runtime messages.
 *  3. Find the current active tab.
 *  4. Programmatically inject the content script.
 *  5. Perform a minimal round-trip with the content script.
 *  6. Return a sanitized result to the Side Panel.
 *
 * No extraction, no PageContext, no capture state, no long-lived global job
 * state. The service worker is not a durable process.
 */
import {
  CONTENT_RUNTIME_CHECK_REQUEST,
  isContentRuntimeCheckSuccess,
  isRuntimeCheckRequest,
  RUNTIME_CHECK_FAILURE,
  RUNTIME_CHECK_SUCCESS,
} from "../messaging/runtime-messages";
import type { RuntimeCheckFailure, RuntimeCheckSuccess } from "../messaging/runtime-messages";

const ACCESS_DENIED_MESSAGE = "Current page cannot be accessed by the extension.";

function configureSidePanel(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      // Foundation limitation: keep the worker alive; never surface raw errors
      // to the UI and never log page data.
      console.warn("Page2Agent: side panel action behavior could not be configured.", error);
    });
}

async function runRuntimeCheck(
  requestId: string,
): Promise<RuntimeCheckSuccess | RuntimeCheckFailure> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return { type: RUNTIME_CHECK_FAILURE, requestId, message: ACCESS_DENIED_MESSAGE };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["assets/content-script.js"],
    });
  } catch {
    // Restricted pages (chrome://, edge://, Web Store, ...) cannot be injected.
    return { type: RUNTIME_CHECK_FAILURE, requestId, message: ACCESS_DENIED_MESSAGE };
  }

  try {
    const response: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: CONTENT_RUNTIME_CHECK_REQUEST,
      requestId,
    });
    if (isContentRuntimeCheckSuccess(response) && response.requestId === requestId) {
      return { type: RUNTIME_CHECK_SUCCESS, requestId };
    }
    return { type: RUNTIME_CHECK_FAILURE, requestId, message: ACCESS_DENIED_MESSAGE };
  } catch {
    return { type: RUNTIME_CHECK_FAILURE, requestId, message: ACCESS_DENIED_MESSAGE };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeCheckRequest(message)) {
    // Unknown or malformed message: ignore, never respond as something else.
    return false;
  }
  // Explicit async response pattern: keep the channel open with `return true`
  // and respond later. Compatible with MV3 on Chrome and Edge.
  void runRuntimeCheck(message.requestId).then(sendResponse);
  return true;
});

configureSidePanel();
