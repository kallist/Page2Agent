import { describe, expect, it } from "vitest";
import {
  CAPTURE_FAILURE,
  HARNESS_CAPTURE_REQUEST,
  CAPTURE_SUCCESS,
  CONTENT_CAPTURE_FAILURE,
  CONTENT_CAPTURE_REQUEST,
  CONTENT_CAPTURE_SUCCESS,
  isCaptureFailure,
  isHarnessCaptureRequest,
  isCaptureSuccess,
  isContentCaptureFailure,
  isContentCaptureRequest,
  isContentCaptureSuccess,
} from "../../../../src/extension/messaging/runtime-messages";
import {
  isCaptureErrorView,
  isCaptureResult,
} from "../../../../src/extension/capture/capture-result";
import type { CaptureResult } from "../../../../src/extension/capture/capture-result";
import type { NormalizedDocument, PageContext } from "../../../../src/core";

const CONTEXT: PageContext = {
  captureId: "11111111-1111-4111-8111-111111111111",
  tabId: 7,
  url: "https://example.com/article",
  title: "Example",
  capturedAt: "2026-08-31T00:00:00.000Z",
};

const DOCUMENT: NormalizedDocument = {
  schemaVersion: 1,
  source: { kind: "web", url: "https://example.com/article" },
  metadata: { title: "Example", capturedAt: "2026-08-31T00:00:00.000Z" },
  blocks: [{ type: "paragraph", text: "Body." }],
  assets: [],
};

const RESULT: CaptureResult = {
  schemaVersion: 1,
  captureId: "c1",
  tabId: 7,
  url: "https://example.com/article",
  capturedAt: "2026-08-31T00:00:00.000Z",
  sourceKind: "web",
  title: "Example",
  actionKind: "use_as_context",
  stats: { characters: 5, codeBlocks: 0, links: 0 },
  markdown: "# Example",
  agentContext: "# Page2Agent Context",
  filename: "example.md",
};

describe("capture message guards", () => {
  it("accepts an exact E2E harness action tab and rejects malformed ones", () => {
    const tab = { id: 7, windowId: 12, url: "http://127.0.0.1/article", title: "Article" };
    expect(isHarnessCaptureRequest({ type: HARNESS_CAPTURE_REQUEST, tab })).toBe(true);
    expect(isHarnessCaptureRequest({ type: HARNESS_CAPTURE_REQUEST })).toBe(false);
    expect(isHarnessCaptureRequest({ type: HARNESS_CAPTURE_REQUEST, tab: { ...tab, id: -1 } })).toBe(false);
    expect(isHarnessCaptureRequest({ type: HARNESS_CAPTURE_REQUEST, tab: { ...tab, windowId: -1 } })).toBe(false);
    expect(isHarnessCaptureRequest({ type: HARNESS_CAPTURE_REQUEST, tab: { ...tab, url: "" } })).toBe(false);
    expect(isHarnessCaptureRequest({ type: "capture.other", tab })).toBe(false);
    expect(isHarnessCaptureRequest(null)).toBe(false);
    expect(isHarnessCaptureRequest("harness.capture.request")).toBe(false);
    expect(isHarnessCaptureRequest({ type: HARNESS_CAPTURE_REQUEST, tab, extra: 1 })).toBe(false);
  });

  it("accepts valid capture.success with a valid result", () => {
    expect(isCaptureSuccess({ type: CAPTURE_SUCCESS, captureId: "c1", result: RESULT })).toBe(true);
    expect(isCaptureSuccess({ type: CAPTURE_SUCCESS, captureId: "c1" })).toBe(false);
    expect(
      isCaptureSuccess({ type: CAPTURE_SUCCESS, captureId: "c1", result: { ...RESULT, stats: { characters: "x", codeBlocks: 0, links: 0 } } }),
    ).toBe(false);
  });

  it("accepts valid capture.failure with a safe error view", () => {
    expect(
      isCaptureFailure({
        type: CAPTURE_FAILURE,
        captureId: "c1",
        error: { code: "NO_CONTENT_FOUND", message: "Nothing." },
      }),
    ).toBe(true);
    expect(
      isCaptureFailure({ type: CAPTURE_FAILURE, captureId: "c1", error: { code: "", message: "x" } }),
    ).toBe(false);
    expect(
      isCaptureFailure({ type: CAPTURE_FAILURE, captureId: "c1", error: { code: "X", message: "x", stack: "s" } }),
    ).toBe(false);
  });

  it("accepts valid content capture messages", () => {
    expect(isContentCaptureRequest({ type: CONTENT_CAPTURE_REQUEST, context: CONTEXT })).toBe(true);
    expect(isContentCaptureRequest({ type: CONTENT_CAPTURE_REQUEST })).toBe(false);
    expect(
      isContentCaptureRequest({
        type: CONTENT_CAPTURE_REQUEST,
        context: { ...CONTEXT, captureId: "" },
      }),
    ).toBe(false);
    expect(
      isContentCaptureSuccess({ type: CONTENT_CAPTURE_SUCCESS, captureId: "c1", document: DOCUMENT }),
    ).toBe(true);
    expect(
      isContentCaptureSuccess({
        type: CONTENT_CAPTURE_SUCCESS,
        captureId: "c1",
        document: { ...DOCUMENT, schemaVersion: 2 },
      }),
    ).toBe(false);
    expect(
      isContentCaptureFailure({
        type: CONTENT_CAPTURE_FAILURE,
        captureId: "c1",
        error: { code: "NO_CONTENT_FOUND", message: "Nothing." },
      }),
    ).toBe(true);
  });

  it("never accepts one message type as another", () => {
    expect(isHarnessCaptureRequest({ type: CONTENT_CAPTURE_REQUEST, context: CONTEXT })).toBe(false);
    expect(isContentCaptureRequest({ type: HARNESS_CAPTURE_REQUEST, tab: {} })).toBe(false);
  });
});

describe("CaptureResult validator", () => {
  it("accepts a fully valid result", () => {
    expect(isCaptureResult(RESULT)).toBe(true);
  });

  it("rejects wrong schema version, missing fields and extra keys", () => {
    expect(isCaptureResult({ ...RESULT, schemaVersion: 2 })).toBe(false);
    const { title: _title, ...withoutTitle } = RESULT;
    expect(isCaptureResult(withoutTitle)).toBe(false);
    expect(isCaptureResult({ ...RESULT, extra: true })).toBe(false);
    expect(isCaptureResult({ ...RESULT, tabId: -1 })).toBe(false);
    expect(isCaptureResult({ ...RESULT, sourceKind: "pdf" })).toBe(false);
    expect(isCaptureResult({ ...RESULT, actionKind: "summarize" })).toBe(false);
    expect(isCaptureResult({ ...RESULT, filename: "" })).toBe(false);
  });
});

describe("CaptureErrorView validator", () => {
  it("requires a code and a non-empty message without extra fields", () => {
    expect(isCaptureErrorView({ code: "CAPTURE_FAILED", message: "Failed." })).toBe(true);
    expect(isCaptureErrorView({ code: "CAPTURE_FAILED" })).toBe(false);
    expect(isCaptureErrorView({ code: "CAPTURE_FAILED", message: "" })).toBe(false);
    expect(isCaptureErrorView({ code: "CAPTURE_FAILED", message: "x", cause: {} })).toBe(false);
  });
});
