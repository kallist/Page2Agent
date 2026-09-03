/**
 * Service Worker lens router (V1.1).
 *
 * The Side Panel never messages content scripts directly (no tabs
 * permission); the worker forwards lens requests to the exact tab recorded
 * in the capture session and relays the content script's response. Requests
 * are validated before forwarding; send failures become safe error views.
 */
import { Page2AgentErrorCode, userSafeMessage } from "../../core";
import {
  LENS_CLEAR_RESPONSE,
  LENS_ENTER_RESPONSE,
  LENS_MATERIALIZE_RESPONSE,
  LENS_QUERY_RESPONSE,
  LENS_SELECTION_CAPTURE_RESPONSE,
  LENS_SELECTION_PROBE_RESPONSE,
  isLensRoutedRequest,
} from "../messaging/lens-messages";
import type { CaptureErrorView } from "../capture/capture-result";

export interface LensRouteDeps {
  sendMessageToTab(tabId: number, message: unknown): Promise<unknown>;
}

export async function handleLensRoutedRequest(
  message: unknown,
  deps: LensRouteDeps,
): Promise<unknown> {
  if (!isLensRoutedRequest(message)) {
    return null;
  }
  try {
    return await deps.sendMessageToTab(message.tabId, message);
  } catch {
    return lensRouteFailure(message);
  }
}

type RoutedRequestShape = { type: string; captureId?: string; session?: { captureId: string } };

function lensRouteFailure(request: RoutedRequestShape): unknown {
  const captureId = request.captureId ?? request.session?.captureId ?? "unknown";
  const error: CaptureErrorView = {
    code: Page2AgentErrorCode.CAPTURE_FAILED,
    message: userSafeMessage(Page2AgentErrorCode.CAPTURE_FAILED),
  };
  switch (request.type) {
    case "lens.enter.request":
      return { type: LENS_ENTER_RESPONSE, captureId, ok: false, error };
    case "lens.query.request":
      return { type: LENS_QUERY_RESPONSE, captureId, ok: false, error };
    case "lens.materialize.request":
      return { type: LENS_MATERIALIZE_RESPONSE, captureId, ok: false, error };
    case "lens.clear.request":
      return { type: LENS_CLEAR_RESPONSE, captureId, ok: false, error };
    case "lens.selection.probe.request":
      return { type: LENS_SELECTION_PROBE_RESPONSE, captureId, ok: false, error };
    case "lens.selection.capture.request":
      return { type: LENS_SELECTION_CAPTURE_RESPONSE, captureId, ok: false, error };
    default:
      return null;
  }
}
