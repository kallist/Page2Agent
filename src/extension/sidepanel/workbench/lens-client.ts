/**
 * Panel-side Context Lens client (V1.1).
 *
 * All lens requests travel through the Service Worker router to the exact
 * captured tab. Responses are validated from `unknown`; malformed or failed
 * responses become typed failures — the panel never trusts the channel.
 */
import { Page2AgentErrorCode, userSafeMessage } from "../../../core";
import {
  isLensClearResponse,
  isLensEnterResponse,
  isLensMaterializeResponse,
  isLensSelectionCaptureResponse,
  isLensSelectionProbeResponse,
} from "../../messaging/lens-messages";
import type {
  LensClearResponse,
  LensEnterResponse,
  LensMaterializeResponse,
  LensSelectionCaptureResponse,
  LensSelectionProbeResponse,
  LensSessionRef,
} from "../../messaging/lens-messages";
import type { CaptureErrorView } from "../../capture/capture-result";

export interface PanelLensClientDeps {
  /** chrome.runtime.sendMessage in production. */
  request(message: unknown): Promise<unknown>;
}

export interface PanelLensClient {
  enter(tabId: number, session: LensSessionRef): Promise<LensEnterResponse>;
  materialize(tabId: number, session: LensSessionRef): Promise<LensMaterializeResponse>;
  clear(tabId: number, captureId: string): Promise<LensClearResponse>;
  probeSelection(tabId: number, session: LensSessionRef): Promise<LensSelectionProbeResponse>;
  captureSelection(
    tabId: number,
    session: LensSessionRef,
  ): Promise<LensSelectionCaptureResponse>;
}

export function createPanelLensClient(deps: PanelLensClientDeps): PanelLensClient {
  /** A rejected runtime send becomes a null response → typed failure below. */
  async function send(message: unknown): Promise<unknown> {
    try {
      return await deps.request(message);
    } catch {
      return null;
    }
  }

  return {
    async enter(tabId, session) {
      const response = await send({
        type: "lens.enter.request",
        tabId,
        session,
      });
      if (isLensEnterResponse(response)) {
        return response;
      }
      return enterFailure(session.captureId);
    },

    async materialize(tabId, session) {
      const response = await send({
        type: "lens.materialize.request",
        tabId,
        session,
      });
      if (isLensMaterializeResponse(response)) {
        return response;
      }
      return {
        type: "lens.materialize.response" as const,
        captureId: session.captureId,
        ok: false,
        error: genericFailure(),
      };
    },

    async clear(tabId, captureId) {
      const response = await send({ type: "lens.clear.request", tabId, captureId });
      if (isLensClearResponse(response)) {
        return response;
      }
      return { type: "lens.clear.response" as const, captureId, ok: false, error: genericFailure() };
    },

    async probeSelection(tabId, session) {
      const response = await send({
        type: "lens.selection.probe.request",
        tabId,
        session,
      });
      if (isLensSelectionProbeResponse(response)) {
        return response;
      }
      return {
        type: "lens.selection.probe.response" as const,
        captureId: session.captureId,
        ok: false,
        error: genericFailure(),
      };
    },

    async captureSelection(tabId, session) {
      const response = await send({
        type: "lens.selection.capture.request",
        tabId,
        session,
      });
      if (isLensSelectionCaptureResponse(response)) {
        return response;
      }
      return {
        type: "lens.selection.capture.response" as const,
        captureId: session.captureId,
        ok: false,
        error: genericFailure(),
      };
    },
  };
}

function enterFailure(captureId: string): LensEnterResponse {
  return {
    type: "lens.enter.response",
    captureId,
    ok: false,
    error: genericFailure(),
  };
}

function genericFailure(): CaptureErrorView {
  return {
    code: Page2AgentErrorCode.INVALID_MESSAGE,
    message: userSafeMessage(Page2AgentErrorCode.INVALID_MESSAGE),
  };
}
