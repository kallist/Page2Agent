import { describe, expect, it } from "vitest";
import {
  isWindowDocumentRecord,
  readWindowDocumentForCapture,
  windowDocumentKey,
  writeWindowDocument,
} from "../../../../src/extension/session/document-cache";
import type { SessionStorage } from "../../../../src/extension/session/session-storage";
import { makeGitHubIssueDocument } from "../../../helpers/workbench-fixtures";

function fakeStorage(): SessionStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key) {
      return data[key];
    },
    async set(key, value) {
      data[key] = value;
    },
    async remove(key) {
      delete data[key];
    },
  };
}

describe("window document cache", () => {
  it("stores one document per window under its key", async () => {
    const storage = fakeStorage();
    const document = makeGitHubIssueDocument();
    await writeWindowDocument(storage, 5, { schemaVersion: 1, captureId: "c1", document });
    expect(storage.data[windowDocumentKey(5)]).toBeDefined();
    const read = await readWindowDocumentForCapture(storage, 5, "c1");
    expect(read).toEqual(document);
  });

  it("refuses stale captures (captureId mismatch)", async () => {
    const storage = fakeStorage();
    await writeWindowDocument(storage, 5, {
      schemaVersion: 1,
      captureId: "c1",
      document: makeGitHubIssueDocument(),
    });
    expect(await readWindowDocumentForCapture(storage, 5, "c2")).toBeNull();
  });

  it("never returns malformed cache content", async () => {
    const storage = fakeStorage();
    storage.data[windowDocumentKey(5)] = { schemaVersion: 1, captureId: "c1", document: { bad: true } };
    expect(await readWindowDocumentForCapture(storage, 5, "c1")).toBeNull();
    expect(isWindowDocumentRecord("garbage")).toBe(false);
  });
});
