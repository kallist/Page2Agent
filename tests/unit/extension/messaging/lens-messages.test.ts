import { describe, expect, it } from "vitest";
import {
  LENS_ENTER_REQUEST,
  LENS_ENTER_RESPONSE,
  LENS_MATERIALIZE_RESPONSE,
  LENS_QUERY_REQUEST,
  LENS_STATE_EVENT,
  isLensEnterRequest,
  isLensEnterResponse,
  isLensMaterializeResponse,
  isLensQueryRequest,
  isLensRoutedRequest,
  isLensSelectionCaptureResponse,
  isLensStateEvent,
} from "../../../../src/extension/messaging/lens-messages";
import { makeWebDocument } from "../../../helpers/workbench-fixtures";

const SESSION = {
  captureId: "capture-lens-1",
  url: "https://example.com/article",
  title: "Article",
  capturedAt: "2026-09-01T00:00:00.000Z",
};

describe("lens message contracts", () => {
  it("validates routed requests strictly", () => {
    const enter = { type: LENS_ENTER_REQUEST, tabId: 7, session: SESSION };
    expect(isLensEnterRequest(enter)).toBe(true);
    expect(isLensRoutedRequest(enter)).toBe(true);
    expect(isLensEnterRequest({ ...enter, tabId: -1 })).toBe(false);
    expect(isLensEnterRequest({ ...enter, extra: 1 })).toBe(false);
    expect(isLensEnterRequest({ ...enter, session: { ...SESSION, captureId: "" } })).toBe(false);

    const query = { type: LENS_QUERY_REQUEST, tabId: 7, captureId: "c1" };
    expect(isLensQueryRequest(query)).toBe(true);
    expect(isLensRoutedRequest(query)).toBe(true);
    expect(isLensQueryRequest({ ...query, captureId: 1 })).toBe(false);
  });

  it("validates enter responses", () => {
    expect(
      isLensEnterResponse({
        type: LENS_ENTER_RESPONSE,
        captureId: "c1",
        ok: true,
        snapshot: { active: true, selectedCount: 0, estimatedTokens: 0 },
      }),
    ).toBe(true);
    expect(
      isLensEnterResponse({
        type: LENS_ENTER_RESPONSE,
        captureId: "c1",
        ok: false,
        error: { code: "PAGE_NAVIGATED", message: "The page changed during capture." },
      }),
    ).toBe(true);
    expect(
      isLensEnterResponse({
        type: LENS_ENTER_RESPONSE,
        captureId: "c1",
        ok: true,
        snapshot: { active: true, selectedCount: -1, estimatedTokens: 0 },
      }),
    ).toBe(false);
  });

  it("validates materialization payloads end to end", () => {
    const document = makeWebDocument();
    expect(
      isLensMaterializeResponse({
        type: LENS_MATERIALIZE_RESPONSE,
        captureId: "c1",
        ok: true,
        materialization: {
          document,
          regions: [{ label: "Reproduction", tokens: 42, characters: 210 }],
        },
      }),
    ).toBe(true);
    expect(
      isLensMaterializeResponse({
        type: LENS_MATERIALIZE_RESPONSE,
        captureId: "c1",
        ok: true,
        materialization: {
          document: { ...document, blocks: [] },
          regions: [],
        },
      }),
    ).toBe(false);
    // Empty materialization (nothing picked) is valid and not an error.
    expect(
      isLensMaterializeResponse({ type: LENS_MATERIALIZE_RESPONSE, captureId: "c1", ok: true }),
    ).toBe(true);
  });

  it("validates live state events", () => {
    expect(
      isLensStateEvent({
        type: LENS_STATE_EVENT,
        captureId: "c1",
        snapshot: { active: true, selectedCount: 2, estimatedTokens: 350 },
      }),
    ).toBe(true);
    expect(isLensStateEvent({ type: LENS_STATE_EVENT, captureId: "", snapshot: {} })).toBe(false);
  });

  it("validates clear, selection-probe and selection-capture messages", () => {
    const clear = { type: "lens.clear.request", tabId: 7, captureId: "c1" };
    expect(isLensRoutedRequest(clear)).toBe(true);
    expect(
      isLensRoutedRequest({
        type: "lens.selection.probe.request",
        tabId: 7,
        session: SESSION,
      }),
    ).toBe(true);
    expect(
      isLensRoutedRequest({
        type: "lens.selection.capture.request",
        tabId: 7,
        session: SESSION,
      }),
    ).toBe(true);

    expect(
      isLensSelectionCaptureResponse({
        type: "lens.selection.capture.response",
        captureId: "c1",
        ok: true,
        document: makeWebDocument(),
      }),
    ).toBe(true);
    expect(
      isLensSelectionCaptureResponse({
        type: "lens.selection.capture.response",
        captureId: "c1",
        ok: true,
        document: { bad: true },
      }),
    ).toBe(false);
  });
});
