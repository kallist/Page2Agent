import { describe, expect, it } from "vitest";
import { handleLensRoutedRequest } from "../../../../src/extension/background/lens-route";

const SESSION = {
  captureId: "c1",
  url: "https://example.com/a",
  title: "A",
  capturedAt: "2026-09-01T00:00:00.000Z",
};

describe("handleLensRoutedRequest (service worker router)", () => {
  it("forwards lens requests to the exact tab and relays the response", async () => {
    const forwarded: unknown[] = [];
    const response = await handleLensRoutedRequest(
      { type: "lens.enter.request", tabId: 7, session: SESSION },
      {
        sendMessageToTab: async (tabId, message) => {
          forwarded.push({ tabId, message });
          return { type: "lens.enter.response", captureId: "c1", ok: true };
        },
      },
    );
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({ tabId: 7 });
    expect(response).toEqual({ type: "lens.enter.response", captureId: "c1", ok: true });
  });

  it("turns send failures into safe typed failure responses", async () => {
    const response = await handleLensRoutedRequest(
      { type: "lens.materialize.request", tabId: 7, session: SESSION },
      {
        sendMessageToTab: async () => {
          throw new Error("no receiver");
        },
      },
    );
    expect(response).toMatchObject({
      type: "lens.materialize.response",
      captureId: "c1",
      ok: false,
      error: { code: "CAPTURE_FAILED" },
    });
  });

  it("ignores non-lens messages", async () => {
    let called = false;
    const response = await handleLensRoutedRequest(
      { type: "capture.request" },
      {
        sendMessageToTab: async () => {
          called = true;
          return null;
        },
      },
    );
    expect(response).toBeNull();
    expect(called).toBe(false);
  });
});
