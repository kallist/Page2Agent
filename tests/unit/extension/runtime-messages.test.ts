import { describe, expect, it } from "vitest";
import {
  CONTENT_RUNTIME_CHECK_FAILURE,
  CONTENT_RUNTIME_CHECK_REQUEST,
  CONTENT_RUNTIME_CHECK_SUCCESS,
  isContentRuntimeCheckFailure,
  isContentRuntimeCheckRequest,
  isContentRuntimeCheckSuccess,
  isRuntimeCheckFailure,
  isRuntimeCheckRequest,
  isRuntimeCheckSuccess,
  RUNTIME_CHECK_FAILURE,
  RUNTIME_CHECK_REQUEST,
  RUNTIME_CHECK_SUCCESS,
} from "../../../src/extension/messaging/runtime-messages";

describe("isRuntimeCheckRequest", () => {
  it("accepts a valid request", () => {
    expect(
      isRuntimeCheckRequest({ type: RUNTIME_CHECK_REQUEST, requestId: "req-1" }),
    ).toBe(true);
  });

  it("rejects a request with a missing requestId", () => {
    expect(isRuntimeCheckRequest({ type: RUNTIME_CHECK_REQUEST })).toBe(false);
  });

  it("rejects a request with an empty requestId", () => {
    expect(
      isRuntimeCheckRequest({ type: RUNTIME_CHECK_REQUEST, requestId: "" }),
    ).toBe(false);
  });

  it("rejects a request with a non-string requestId", () => {
    expect(
      isRuntimeCheckRequest({ type: RUNTIME_CHECK_REQUEST, requestId: 42 }),
    ).toBe(false);
  });

  it("rejects the wrong message type", () => {
    expect(
      isRuntimeCheckRequest({ type: "runtime.other", requestId: "req-1" }),
    ).toBe(false);
  });

  it("rejects malformed raw payloads", () => {
    expect(isRuntimeCheckRequest(null)).toBe(false);
    expect(isRuntimeCheckRequest(undefined)).toBe(false);
    expect(isRuntimeCheckRequest([])).toBe(false);
    expect(isRuntimeCheckRequest(42)).toBe(false);
    expect(isRuntimeCheckRequest("runtime.check.request")).toBe(false);
    expect(isRuntimeCheckRequest({ type: RUNTIME_CHECK_REQUEST, requestId: "x", extra: 1 })).toBe(
      false,
    );
  });
});

describe("runtime response guards", () => {
  it("accepts a valid success response and rejects malformed ones", () => {
    expect(isRuntimeCheckSuccess({ type: RUNTIME_CHECK_SUCCESS, requestId: "req-1" })).toBe(true);
    expect(isRuntimeCheckSuccess({ type: RUNTIME_CHECK_SUCCESS })).toBe(false);
    expect(isRuntimeCheckSuccess({ type: RUNTIME_CHECK_FAILURE, requestId: "req-1" })).toBe(false);
    expect(isRuntimeCheckSuccess(null)).toBe(false);
    expect(isRuntimeCheckSuccess("ok")).toBe(false);
  });

  it("accepts a valid failure response and rejects malformed ones", () => {
    expect(
      isRuntimeCheckFailure({
        type: RUNTIME_CHECK_FAILURE,
        requestId: "req-1",
        message: "Current page cannot be accessed.",
      }),
    ).toBe(true);
    expect(
      isRuntimeCheckFailure({ type: RUNTIME_CHECK_FAILURE, requestId: "req-1", message: "" }),
    ).toBe(false);
    expect(
      isRuntimeCheckFailure({ type: RUNTIME_CHECK_FAILURE, requestId: "req-1" }),
    ).toBe(false);
    expect(
      isRuntimeCheckFailure({
        type: RUNTIME_CHECK_FAILURE,
        requestId: "req-1",
        message: "x",
        extra: true,
      }),
    ).toBe(false);
  });
});

describe("content runtime check guards", () => {
  it("accepts a valid content request", () => {
    expect(
      isContentRuntimeCheckRequest({ type: CONTENT_RUNTIME_CHECK_REQUEST, requestId: "req-1" }),
    ).toBe(true);
  });

  it("rejects malformed content requests", () => {
    expect(isContentRuntimeCheckRequest({ type: CONTENT_RUNTIME_CHECK_REQUEST })).toBe(false);
    expect(
      isContentRuntimeCheckRequest({ type: CONTENT_RUNTIME_CHECK_REQUEST, requestId: "" }),
    ).toBe(false);
    expect(isContentRuntimeCheckRequest(null)).toBe(false);
    expect(isContentRuntimeCheckRequest({})).toBe(false);
  });

  it("accepts a valid content success response", () => {
    expect(
      isContentRuntimeCheckSuccess({ type: CONTENT_RUNTIME_CHECK_SUCCESS, requestId: "req-1" }),
    ).toBe(true);
    expect(isContentRuntimeCheckSuccess({ type: CONTENT_RUNTIME_CHECK_SUCCESS })).toBe(false);
  });

  it("accepts a valid content failure response", () => {
    expect(
      isContentRuntimeCheckFailure({
        type: CONTENT_RUNTIME_CHECK_FAILURE,
        requestId: "req-1",
        message: "check failed",
      }),
    ).toBe(true);
    expect(
      isContentRuntimeCheckFailure({
        type: CONTENT_RUNTIME_CHECK_FAILURE,
        requestId: "req-1",
        message: "",
      }),
    ).toBe(false);
  });

  it("never accepts one message type as another", () => {
    expect(isContentRuntimeCheckRequest({ type: RUNTIME_CHECK_REQUEST, requestId: "r" })).toBe(
      false,
    );
    expect(isRuntimeCheckRequest({ type: CONTENT_RUNTIME_CHECK_REQUEST, requestId: "r" })).toBe(
      false,
    );
  });
});
