// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createLensController } from "../../../../../src/extension/content/lens/lens-controller";
import {
  LENS_ENTER_RESPONSE,
  LENS_MATERIALIZE_RESPONSE,
  LENS_STATE_EVENT,
} from "../../../../../src/extension/messaging/lens-messages";
import type {
  LensEnterResponse,
  LensMaterializeResponse,
  LensSessionRef,
} from "../../../../../src/extension/messaging/lens-messages";
import { isNormalizedDocument } from "../../../../../src/core";

const SESSION: LensSessionRef = {
  captureId: "capture-lens-1",
  url: "https://example.com/article",
  title: "Article",
  capturedAt: "2026-09-01T00:00:00.000Z",
};

type JsdomWindow = Window & { MouseEvent: typeof MouseEvent };

function makeDeps(broadcasts: unknown[] = []) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <main>
        <h2 id="h">Section A</h2>
        <p id="p1">First paragraph with several words.</p>
        <p id="p2">Second paragraph content.</p>
      </main>
    </body></html>`,
    { url: SESSION.url },
  );
  const { document } = dom.window;
  const window = dom.window as unknown as JsdomWindow;
  const controller = createLensController({
    locationHref: () => window.location.href,
    document,
    window,
    broadcast: (message) => broadcasts.push(message),
  });
  return { controller, document, window, broadcasts };
}

/** Events must come from the SAME jsdom window as the target document. */
function clickOn(window: JsdomWindow, target: Element): void {
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  target.dispatchEvent(event);
}

async function handleEnter(controller: ReturnType<typeof createLensController>) {
  const response = (await controller.handle({
    type: "lens.enter.request",
    tabId: 7,
    session: SESSION,
  })) as LensEnterResponse;
  return response;
}

async function handleMaterialize(controller: ReturnType<typeof createLensController>) {
  const response = (await controller.handle({
    type: "lens.materialize.request",
    tabId: 7,
    session: SESSION,
  })) as LensMaterializeResponse;
  return response;
}

describe("lens controller — content script side", () => {
  it("enters lens mode for the captured page and broadcasts state", async () => {
    const { controller, document, window, broadcasts } = makeDeps();
    const response = await handleEnter(controller);
    expect(response).toMatchObject({ type: LENS_ENTER_RESPONSE, ok: true, captureId: SESSION.captureId });
    expect(response.snapshot).toEqual({ active: true, selectedCount: 0, estimatedTokens: 0 });

    // Clicking content picks a region and broadcasts a live state event.
    clickOn(window, document.getElementById("p1")!);
    expect(broadcasts.some((message: unknown) =>
      (message as { type: string }).type === LENS_STATE_EVENT &&
      (message as { snapshot?: { selectedCount?: number } }).snapshot?.selectedCount === 1,
    )).toBe(true);
  });

  it("refuses to enter when the page navigated away from the capture", async () => {
    const { controller } = makeDeps();
    const response = (await controller.handle({
      type: "lens.enter.request",
      tabId: 7,
      session: { ...SESSION, url: "https://example.com/other-page" },
    })) as LensEnterResponse;
    expect(response).toMatchObject({ ok: false, error: { code: "PAGE_NAVIGATED" } });
  });

  it("materializes picks into a validated fragment document", async () => {
    const { controller, document, window } = makeDeps();
    await handleEnter(controller);
    clickOn(window, document.getElementById("h")!);
    const response = await handleMaterialize(controller);
    expect(response.type).toBe(LENS_MATERIALIZE_RESPONSE);
    expect(response.ok).toBe(true);
    const materialization = response.materialization;
    expect(materialization).not.toBeNull();
    expect(materialization?.document).toBeDefined();
    expect(isNormalizedDocument(materialization!.document)).toBe(true);
    expect(materialization!.document.source.kind).toBe("web");
    expect(materialization!.document.capture).toEqual({
      adapter: { id: "context-lens", name: "Context Lens" },
      scope: "selection",
    });
    expect(materialization!.regions[0].label).toBe("Section A");
  });

  it("answers materialize with an empty ok when nothing is picked", async () => {
    const { controller } = makeDeps();
    await handleEnter(controller);
    const response = await handleMaterialize(controller);
    expect(response).toMatchObject({ ok: true });
    expect(response.materialization).toBeUndefined();
  });

  it("ignores unknown messages", async () => {
    const { controller } = makeDeps();
    expect(await controller.handle({ type: "something.else" })).toBeNull();
  });

  it("clears retained picks after a successful hand-off", async () => {
    const { controller, document, window } = makeDeps();
    await handleEnter(controller);
    clickOn(window, document.getElementById("p1")!);
    const clear = (await controller.handle({
      type: "lens.clear.request",
      tabId: 7,
      captureId: SESSION.captureId,
    })) as { ok: boolean };
    expect(clear.ok).toBe(true);
    const response = await handleMaterialize(controller);
    expect(response.materialization).toBeUndefined();
  });

  it("probes the page for an existing user text selection", async () => {
    const { controller } = makeDeps();
    const probe = (await controller.handle({
      type: "lens.selection.probe.request",
      tabId: 7,
      session: SESSION,
    })) as { ok: boolean; hasSelection: boolean };
    expect(probe.ok).toBe(true);
    expect(probe.hasSelection).toBe(false);
  });

  it("fails the text-selection capture cleanly when nothing is selected", async () => {
    const { controller } = makeDeps();
    const capture = (await controller.handle({
      type: "lens.selection.capture.request",
      tabId: 7,
      session: SESSION,
    })) as { ok: boolean; error?: { code: string } };
    expect(capture.ok).toBe(false);
    expect(capture.error?.code).toBe("NO_CONTENT_FOUND");
  });
});
