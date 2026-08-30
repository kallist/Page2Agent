import { describe, expect, it, vi } from "vitest";
import { CONTENT_RUNTIME_CHECK_SUCCESS } from "../../../src/extension/messaging/runtime-messages";
import {
  CONTENT_SCRIPT_READY_FLAG,
  createGlobalInitializationState,
  handleMessage,
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

describe("content script message handler", () => {
  it("responds with success and echoes the requestId for a valid request", () => {
    const sendResponse = vi.fn();
    handleMessage(
      { type: "content.runtimeCheck.request", requestId: "req-1" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: CONTENT_RUNTIME_CHECK_SUCCESS,
      requestId: "req-1",
    });
  });

  it("does not respond to unknown or malformed messages", () => {
    const sendResponse = vi.fn();
    for (const message of [
      null,
      "hello",
      42,
      { type: "content.runtimeCheck.request" },
      { type: "runtime.check.request", requestId: "req-1" },
      { type: "content.runtimeCheck.request", requestId: "", extra: true },
    ]) {
      handleMessage(message, {} as chrome.runtime.MessageSender, sendResponse);
    }

    expect(sendResponse).not.toHaveBeenCalled();
  });
});
