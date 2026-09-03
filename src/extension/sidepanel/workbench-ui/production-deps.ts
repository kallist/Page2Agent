/**
 * Production wiring for the V1.1 workbench (chrome bindings).
 * Kept separate so App/hooks stay fully fake-able in tests.
 */
import { chromeSessionStorage } from "../../session/session-storage";
import { createPanelLensClient } from "../workbench/lens-client";
import type { WorkbenchDeps } from "../use-workbench";

export function createProductionWorkbenchDeps(): WorkbenchDeps {
  return {
    storage: chromeSessionStorage,
    windowId: async () => {
      const browserWindow = await chrome.windows.getCurrent();
      const windowId = browserWindow.id;
      if (windowId === undefined || !Number.isSafeInteger(windowId) || windowId < 0) {
        throw new Error("The Side Panel browser window could not be resolved.");
      }
      return windowId;
    },
    lens: createPanelLensClient({
      request: (message: unknown) => chrome.runtime.sendMessage(message),
    }),
    subscribeMessages: (listener) => {
      const handler = (message: unknown): void => {
        listener(message);
      };
      chrome.runtime.onMessage.addListener(handler);
      return () => chrome.runtime.onMessage.removeListener(handler);
    },
  };
}
