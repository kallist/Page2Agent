/**
 * MV3 Service Worker — production capture orchestration (TASK 07).
 *
 * Responsibilities:
 *  1. Configure Side Panel action behavior.
 *  2. Receive validated capture.request messages from the Side Panel.
 *  3. Delegate to the capture orchestrator (active tab → injection → content
 *     round-trip → packaging → session commit).
 *
 * No durable in-memory capture state: the worker may suspend/restart at any
 * time; the latest-capture source of truth is chrome.storage.session.
 */
import { handleCaptureRequest, chromeCaptureRuntimeDeps } from "./capture";
import { isCaptureRequest } from "../messaging/runtime-messages";

function configureSidePanel(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      // Keep the worker alive; never surface raw errors to the UI.
      console.warn("Page2Agent: side panel action behavior could not be configured.", error);
    });
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isCaptureRequest(message)) {
    // Unknown or malformed message: ignore, never respond as something else.
    return false;
  }
  // Sender trust: only extension-owned contexts may trigger a capture action.
  // (Content-script senders report a web-page sender URL; extension pages
  // report a chrome-extension:// URL even when hosted in a browser tab.)
  const fromExtensionPage = sender.url?.startsWith("chrome-extension://") === true;
  if (sender.tab !== undefined && !fromExtensionPage) {
    return false;
  }
  // Explicit async response pattern: keep the channel open with `return true`
  // and respond later. Compatible with MV3 on Chrome and Edge.
  void handleCaptureRequest(message, chromeCaptureRuntimeDeps).then(sendResponse);
  return true;
});

configureSidePanel();
