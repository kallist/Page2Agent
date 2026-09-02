/**
 * MV3 Service Worker — production action → exact-tab capture orchestration.
 *
 * The toolbar action is both the product trigger and the activeTab grant. The
 * tab supplied by chrome.action.onClicked is captured directly; the Side Panel
 * only restores session state and never guesses or requests another tab.
 */
import { createActionClickHandler } from "./action-capture";
import { captureExactTab, chromeCaptureRuntimeDeps } from "./capture";
import { isHarnessCaptureRequest } from "../messaging/runtime-messages";
import { chromeSessionStorage } from "../session/session-storage";

const handleActionClick = createActionClickHandler({
  storage: chromeSessionStorage,
  openSidePanel: (windowId) => chrome.sidePanel.open({ windowId }),
  capture: (captureId, target) =>
    captureExactTab(captureId, target, chromeCaptureRuntimeDeps),
  createCaptureId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
});

function disableAutomaticPanelAction(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);
}

chrome.action.onClicked.addListener((tab) => {
  // Do not await before createActionClickHandler invokes sidePanel.open(): the
  // call must remain directly inside Chrome's action user-gesture event path.
  void handleActionClick(tab);
});

/**
 * Playwright cannot reliably click Chrome toolbar UI to create an activeTab
 * grant. The E2E-only dist adds one localhost host permission and may emulate
 * the action tab through this gated message. Production dist has no host
 * permissions, so this test seam is fail-closed and unreachable there.
 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isE2eHarnessBuild() || !isHarnessCaptureRequest(message)) {
    return false;
  }
  const fromExtensionPage = sender.url?.startsWith("chrome-extension://") === true;
  if (!fromExtensionPage) {
    return false;
  }
  void handleActionClick(message.tab).then(sendResponse);
  return true;
});

function isE2eHarnessBuild(): boolean {
  const hostPermissions = chrome.runtime.getManifest().host_permissions;
  return (
    Array.isArray(hostPermissions) &&
    hostPermissions.length === 1 &&
    hostPermissions[0] === "http://127.0.0.1/*"
  );
}

// setPanelBehavior is persisted by Chrome. Explicitly turn off the previous
// open-on-action behavior so existing unpacked installs dispatch onClicked.
disableAutomaticPanelAction();
chrome.runtime.onInstalled.addListener(disableAutomaticPanelAction);
