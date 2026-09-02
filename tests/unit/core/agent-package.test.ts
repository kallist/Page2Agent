import { describe, expect, it } from "vitest";
import { isAgentPackage, isAgentTask } from "../../../src/core";
import type { AgentPackage, NormalizedDocument } from "../../../src/core";

function makeDocument(): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: { title: "Article title", capturedAt: "2026-08-30T00:00:00.000Z" },
    blocks: [{ type: "paragraph", text: "App crashes after deleting an Agent." }],
    assets: [],
  };
}

const SOURCE_BLOCK = { type: "paragraph", text: "App crashes after deleting an Agent." } as const;

describe("AgentTask", () => {
  it("accepts the context task", () => {
    expect(isAgentTask({ kind: "context" })).toBe(true);
    expect(isAgentTask({ kind: "context", extra: 1 })).toBe(false);
  });

  it("accepts github_fix_issue with null acceptance criteria (not provided in source)", () => {
    expect(
      isAgentTask({
        kind: "github_fix_issue",
        repository: "acme/widgets",
        issueNumber: 42,
        sourceAcceptanceCriteria: null,
      }),
    ).toBe(true);
  });

  it("accepts github_fix_issue with explicit acceptance criteria", () => {
    expect(
      isAgentTask({
        kind: "github_fix_issue",
        repository: "acme/widgets",
        issueNumber: 42,
        sourceAcceptanceCriteria: ["App does not crash after deletion."],
      }),
    ).toBe(true);
  });

  it("rejects an empty acceptance criteria array (null vs empty semantics)", () => {
    expect(
      isAgentTask({
        kind: "github_fix_issue",
        repository: "acme/widgets",
        issueNumber: 42,
        sourceAcceptanceCriteria: [],
      }),
    ).toBe(false);
  });

  it("rejects malformed repository and issue numbers", () => {
    for (const repository of ["", "no-slash", "a/b/c", "  /x"]) {
      expect(
        isAgentTask({
          kind: "github_fix_issue",
          repository,
          issueNumber: 42,
          sourceAcceptanceCriteria: null,
        }),
      ).toBe(false);
    }
    expect(
      isAgentTask({
        kind: "github_fix_issue",
        repository: "acme/widgets",
        issueNumber: 0,
        sourceAcceptanceCriteria: null,
      }),
    ).toBe(false);
  });
});

describe("AgentPackage", () => {
  it("accepts a valid package with separate generated instructions", () => {
    const pkg: AgentPackage = {
      schemaVersion: 1,
      document: makeDocument(),
      task: {
        kind: "github_fix_issue",
        repository: "acme/widgets",
        issueNumber: 42,
        sourceAcceptanceCriteria: null,
      },
      page2AgentInstructions: ["Add a regression test for the reported crash."],
    };
    expect(isAgentPackage(pkg)).toBe(true);
  });

  it("allows an empty instructions list but rejects malformed entries", () => {
    const base = {
      schemaVersion: 1,
      document: makeDocument(),
      task: { kind: "context" },
    };
    expect(isAgentPackage({ ...base, page2AgentInstructions: [] })).toBe(true);
    expect(isAgentPackage({ ...base, page2AgentInstructions: [""] })).toBe(false);
    expect(isAgentPackage({ ...base, page2AgentInstructions: "not-an-array" })).toBe(false);
  });

  it("rejects an invalid document and malformed task", () => {
    const base = {
      schemaVersion: 1,
      document: makeDocument(),
      task: { kind: "context" },
      page2AgentInstructions: [],
    };
    const badDocument: unknown = { ...base, document: { ...makeDocument(), schemaVersion: 2 } };
    expect(isAgentPackage(badDocument)).toBe(false);
    const badTask: unknown = { ...base, task: { kind: "github_fix_issue" } };
    expect(isAgentPackage(badTask)).toBe(false);
    const extraKey: unknown = { ...base, extra: true };
    expect(isAgentPackage(extraKey)).toBe(false);
  });
});

describe("Source / Generated separation (mandatory regression)", () => {
  it("keeps generated instructions out of source blocks and never mutates the document", () => {
    const document = Object.freeze(makeDocument());
    const pkg: AgentPackage = {
      schemaVersion: 1,
      document,
      task: {
        kind: "github_fix_issue",
        repository: "acme/widgets",
        issueNumber: 42,
        sourceAcceptanceCriteria: null,
      },
      page2AgentInstructions: [
        "Add regression tests for the reported crash.",
        "Verify the deletion flow does not throw.",
      ],
    };

    expect(isAgentPackage(pkg)).toBe(true);

    // 1. The source document keeps exactly its source blocks — no generated
    //    instruction is appended to them.
    expect(pkg.document.blocks).toEqual([SOURCE_BLOCK]);
    expect(pkg.document.blocks).toHaveLength(1);
    expect(
      pkg.document.blocks.some((block) => JSON.stringify(block).includes("regression")),
    ).toBe(false);

    // 2. Generated instructions exist independently.
    expect(pkg.page2AgentInstructions).toEqual([
      "Add regression tests for the reported crash.",
      "Verify the deletion flow does not throw.",
    ]);

    // 3. Package validation did not mutate the (frozen) source document.
    expect(pkg.document).toBe(document);
    expect(pkg.document.blocks).toEqual([SOURCE_BLOCK]);

    // 4. Acceptance criteria are expressed via the task field, never appended
    //    to source content.
    if (pkg.task.kind !== "github_fix_issue") {
      throw new Error("expected github_fix_issue task in test fixture");
    }
    expect(pkg.task.sourceAcceptanceCriteria).toBeNull();
    expect(JSON.stringify(pkg.document)).not.toContain("Acceptance Criteria");
  });
});
