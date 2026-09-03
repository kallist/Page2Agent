// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_SCRIPT_READY_FLAG,
  createContentMessageListener,
  createGlobalInitializationState,
  initializeOnce,
} from "../../../src/extension/content/content-script";
import type { MessageListener } from "../../../src/extension/content/listener";

describe("content script initialization guard", () => {
  it("registers the listener exactly once across repeated initialization", () => {
    const addListener = vi.fn();
    const registrar = { addListener };
    let ready = false;
    const state = {
      isReady: () => ready,
      markReady: () => {
        ready = true;
      },
    };
    const listener: MessageListener = () => undefined;

    expect(initializeOnce(state, registrar, listener)).toBe(true);
    expect(initializeOnce(state, registrar, listener)).toBe(false);
    expect(initializeOnce(state, registrar, listener)).toBe(false);

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledWith(listener);
  });
});

describe("content script global initialization state", () => {
  it("marks readiness on the isolated-world globalThis", () => {
    const state = createGlobalInitializationState();
    const scope = globalThis as typeof globalThis & Record<string, unknown>;

    expect(state.isReady()).toBe(false);
    state.markReady();
    expect(state.isReady()).toBe(true);
    expect(scope[CONTENT_SCRIPT_READY_FLAG]).toBe(true);

    delete scope[CONTENT_SCRIPT_READY_FLAG];
  });
});

describe("production content message listener", () => {
  it("ignores unknown messages without responding (MV3 channel etiquette)", () => {
    const listener = createContentMessageListener();
    const sendResponse = vi.fn();
    const result = listener("not-a-message", {} as chrome.runtime.MessageSender, sendResponse);
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
