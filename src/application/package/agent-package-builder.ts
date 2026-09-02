/**
 * AgentPackageBuilder — application/orchestration layer.
 *
 * NormalizedDocument → AgentPackage. Pure and deterministic:
 * - web source → context task (no guessed summarize/explain/implement intent)
 * - github_issue source → github_fix_issue task, reusing TASK 05's
 *   extractSourceAcceptanceCriteria(blocks) (no DOM, no Markdown parsing)
 * - generated instructions are copied into the package (never shared mutable)
 * - the source document is never mutated
 */
import {
  AGENT_PACKAGE_SCHEMA_VERSION,
  isAgentPackage,
  Page2AgentError,
  Page2AgentErrorCode,
} from "../../core";
import type { AgentPackage, NormalizedDocument } from "../../core";
import { extractSourceAcceptanceCriteria } from "../../adapters/github/acceptance-criteria";
import {
  GENERIC_CONTEXT_INSTRUCTIONS,
  GITHUB_FIX_ISSUE_INSTRUCTIONS,
} from "./page2agent-instructions";

export function buildAgentPackage(document: NormalizedDocument): AgentPackage {
  switch (document.source.kind) {
    case "web": {
      const agentPackage: AgentPackage = {
        schemaVersion: AGENT_PACKAGE_SCHEMA_VERSION,
        document,
        task: { kind: "context" },
        page2AgentInstructions: [...GENERIC_CONTEXT_INSTRUCTIONS],
      };
      return validatePackage(agentPackage);
    }
    case "github_issue": {
      const agentPackage: AgentPackage = {
        schemaVersion: AGENT_PACKAGE_SCHEMA_VERSION,
        document,
        task: {
          kind: "github_fix_issue",
          repository: `${document.source.owner}/${document.source.repo}`,
          issueNumber: document.source.issueNumber,
          sourceAcceptanceCriteria: extractSourceAcceptanceCriteria(document.blocks),
        },
        page2AgentInstructions: [...GITHUB_FIX_ISSUE_INSTRUCTIONS],
      };
      return validatePackage(agentPackage);
    }
    default:
      return assertNeverSource(document.source);
  }
}

function validatePackage(agentPackage: AgentPackage): AgentPackage {
  if (!isAgentPackage(agentPackage)) {
    // Construction failure from validated domain input is a programming
    // invariant failure, not a user-facing error.
    throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
      message: "AgentPackage construction produced an invalid package.",
    });
  }
  return agentPackage;
}

function assertNeverSource(source: never): never {
  throw new Page2AgentError(Page2AgentErrorCode.INVALID_DOCUMENT, {
    message: `Unknown source kind: ${JSON.stringify(source)}`,
  });
}
