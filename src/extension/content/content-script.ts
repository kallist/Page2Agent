/**
 * Programmatically injected Content Script — production capture runtime
 * (TASK 07). Runs in the page's isolated world; never in the MAIN world.
 *
 * Repeated injection safety: the initializer registers the message listener
 * at most once per isolated world using a globalThis flag. The flag lives in
 * the extension isolated world and never touches the page's JS namespace.
 *
 * This script is bundled as a self-contained IIFE (vite.content.config.ts) so
 * repeated injection never depends on shared chunks.
 */
import { handleContentCaptureRequest, createProductionRegistry } from "./content-capture";
import type { MessageListener } from "./listener";

export const CONTENT_SCRIPT_READY_FLAG = "__PAGE2AGENT_CONTENT_SCRIPT_READY__";

export interface InitializationState {
  isReady(): boolean;
  markReady(): void;
}

export interface ListenerRegistrar {
  addListener(listener: MessageListener): void;
}

/**
 * Pure initialization guard: registers `listener` exactly once.
 * Returns true when this call performed the registration, false when the
 * initializer had already run (listener not re-registered).
 */
export function initializeOnce(
  state: InitializationState,
  registrar: ListenerRegistrar,
  listener: MessageListener,
): boolean {
  if (state.isReady()) {
    return false;
  }
  state.markReady();
  registrar.addListener(listener);
  return true;
}

export function createGlobalInitializationState(): InitializationState {
  const scope = globalThis as typeof globalThis & Record<string, unknown>;
  return {
    isReady: () => scope[CONTENT_SCRIPT_READY_FLAG] === true,
    markReady: () => {
      scope[CONTENT_SCRIPT_READY_FLAG] = true;
    },
  };
}

/**
 * Production content listener: any content.capture.request is handled through
 * the testable handler; unknown messages are ignored (never respond as
 * something else). `return true` keeps the channel open for the async reply.
 */
export function createContentMessageListener(): MessageListener {
  const registry = createProductionRegistry();
  return (message, _sender, sendResponse) => {
    void handleContentCaptureRequest(message, {
      locationHref: () => location.href,
      document,
      registry,
    }).then(sendResponse);
    return true;
  };
}

// The chrome runtime always exists in the extension isolated world. The guard
// keeps this module importable in non-browser test environments (Node/vitest),
// where the initialization logic is exercised through initializeOnce() directly.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage !== undefined) {
  initializeOnce(
    createGlobalInitializationState(),
    chrome.runtime.onMessage,
    createContentMessageListener(),
  );
}
