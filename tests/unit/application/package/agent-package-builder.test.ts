import { describe, expect, it } from "vitest";
import {
  buildAgentPackage,
  GENERIC_CONTEXT_INSTRUCTIONS,
  GITHUB_FIX_ISSUE_INSTRUCTIONS,
} from "../../../../src/application";
import { isAgentPackage } from "../../../../src/core";
import type { AgentPackage, NormalizedDocument } from "../../../../src/core";

function makeWebDocument(): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: { kind: "web", url: "https://example.com/article" },
    metadata: { title: "Article title", capturedAt: "2026-08-31T00:00:00.000Z" },
    blocks: [{ type: "paragraph", text: "Body text." }],
    assets: [],
  };
}

function makeGitHubDocument(blocks: NormalizedDocument["blocks"]): NormalizedDocument {
  return {
    schemaVersion: 1,
    source: {
      kind: "github_issue",
      url: "https://github.com/acme/page2agent-demo/issues/42",
      owner: "acme",
      repo: "page2agent-demo",
      issueNumber: 42,
      labels: ["bug"],
    },
    metadata: { title: "Fix deletion crash", capturedAt: "2026-08-31T00:00:00.000Z" },
    blocks,
    assets: [],
  };
}

describe("buildAgentPackage — web source", () => {
  it("builds a context task without guessing summarize/translate/implement", () => {
    const document = makeWebDocument();
    const agentPackage = buildAgentPackage(document);
    expect(isAgentPackage(agentPackage)).toBe(true);
    expect(agentPackage.task).toEqual({ kind: "context" });
    expect(agentPackage.document).toBe(document);
    expect(agentPackage.page2AgentInstructions).toEqual([...GENERIC_CONTEXT_INSTRUCTIONS]);
  });

  it("copies the generic instruction array (no shared mutable reference)", () => {
    const agentPackage = buildAgentPackage(makeWebDocument());
    agentPackage.page2AgentInstructions[0] = "mutated";
    expect(GENERIC_CONTEXT_INSTRUCTIONS[0]).not.toBe("mutated");
    expect(GENERIC_CONTEXT_INSTRUCTIONS).toHaveLength(3);
  });
});

describe("buildAgentPackage — github source", () => {
  it("builds a github_fix_issue task with explicit source AC from blocks", () => {
    const document = makeGitHubDocument([
      { type: "heading", level: 2, text: "Acceptance Criteria" },
      { type: "list", ordered: false, items: ["[x] Latest capture wins", "[ ] Existing content is preserved"] },
    ]);
    const agentPackage = buildAgentPackage(document);
    expect(isAgentPackage(agentPackage)).toBe(true);
    expect(agentPackage.task).toEqual({
      kind: "github_fix_issue",
      repository: "acme/page2agent-demo",
      issueNumber: 42,
      sourceAcceptanceCriteria: ["[x] Latest capture wins", "[ ] Existing content is preserved"],
    });
    expect(agentPackage.page2AgentInstructions).toEqual([...GITHUB_FIX_ISSUE_INSTRUCTIONS]);
    expect(agentPackage.page2AgentInstructions).toHaveLength(10);
  });

  it("keeps sourceAcceptanceCriteria null when the source has no explicit AC", () => {
    const document = makeGitHubDocument([
      { type: "paragraph", text: "App crashes when deleting an agent." },
    ]);
    const agentPackage = buildAgentPackage(document);
    expect(agentPackage.task).toEqual({
      kind: "github_fix_issue",
      repository: "acme/page2agent-demo",
      issueNumber: 42,
      sourceAcceptanceCriteria: null,
    });
  });
});

describe("buildAgentPackage — immutability", () => {
  it("never mutates a frozen input document", () => {
    const document = Object.freeze(makeWebDocument());
    const agentPackage = buildAgentPackage(document);
    expect(agentPackage.document).toBe(document);
    expect(agentPackage.document.blocks).toEqual([{ type: "paragraph", text: "Body text." }]);
    expect(Object.isFrozen(agentPackage.document)).toBe(true);
  });
});

describe("buildAgentPackage — validation", () => {
  it("always produces packages that pass the domain validator", () => {
    const packages: AgentPackage[] = [
      buildAgentPackage(makeWebDocument()),
      buildAgentPackage(
        makeGitHubDocument([
          { type: "heading", level: 2, text: "Acceptance Criteria" },
          { type: "list", ordered: false, items: ["one"] },
        ]),
      ),
      buildAgentPackage(makeGitHubDocument([{ type: "paragraph", text: "No AC here." }])),
    ];
    for (const agentPackage of packages) {
      expect(isAgentPackage(agentPackage)).toBe(true);
    }
  });
});
