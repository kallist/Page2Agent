import { describe, expect, it } from "vitest";
import { createPanelLensClient } from "../../../../../src/extension/sidepanel/workbench/lens-client";
import { makeWebDocument } from "../../../../../tests/helpers/workbench-fixtures";

const SESSION = {
  captureId: "c1",
  url: "https://example.com/a",
  title: "A",
  capturedAt: "2026-09-01T00:00:00.000Z",
};

describe("panel lens client", () => {
  it("sends lens.enter and validates the response", async () => {
    let sent: unknown;
    const client = createPanelLensClient({
      request: async (message) => {
        sent = message;
        return {
          type: "lens.enter.response",
          captureId: "c1",
          ok: true,
          snapshot: { active: true, selectedCount: 0, estimatedTokens: 0 },
        };
      },
    });
    const response = await client.enter(7, SESSION);
    expect(sent).toMatchObject({ type: "lens.enter.request", tabId: 7 });
    expect(response.ok).toBe(true);
  });

  it("materializes picks into validated payloads", async () => {
    const client = createPanelLensClient({
      request: async () => ({
        type: "lens.materialize.response",
        captureId: "c1",
        ok: true,
        materialization: {
          document: makeWebDocument(),
          regions: [{ label: "Reproduction", tokens: 10, characters: 50 }],
        },
      }),
    });
    const response = await client.materialize(7, SESSION);
    expect(response.ok).toBe(true);
    expect(response.materialization?.document.metadata.title).toBe("Example Article");
  });

  it("turns malformed responses into typed failures", async () => {
    const client = createPanelLensClient({ request: async () => ({ garbage: true }) });
    const enter = await client.enter(7, SESSION);
    expect(enter.ok).toBe(false);
    expect(enter.error?.code).toBe("INVALID_MESSAGE");
    const materialize = await client.materialize(7, SESSION);
    expect(materialize.ok).toBe(false);
    expect(materialize.error?.code).toBe("INVALID_MESSAGE");
    const clear = await client.clear(7, "c1");
    expect(clear.ok).toBe(false);
    const probe = await client.probeSelection(7, SESSION);
    expect(probe.ok).toBe(false);
    const capture = await client.captureSelection(7, SESSION);
    expect(capture.ok).toBe(false);
  });

  it("routes text-selection flows with validation", async () => {
    const sent: string[] = [];
    const client = createPanelLensClient({
      request: async (message) => {
        sent.push((message as { type: string }).type);
        return {
          type: "lens.selection.capture.response",
          captureId: "c1",
          ok: true,
          document: makeWebDocument(),
        };
      },
    });
    const response = await client.captureSelection(7, SESSION);
    expect(sent).toContain("lens.selection.capture.request");
    expect(response.ok).toBe(true);
    expect(response.document?.metadata.title).toBe("Example Article");
  });
});
