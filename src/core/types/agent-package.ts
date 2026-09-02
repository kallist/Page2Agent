/**
 * Agent task intent + AgentPackage model.
 *
 * AgentPackage = NormalizedDocument + Task Intent + Page2Agent Generated
 * Instructions. Source facts live ONLY in document.source — the package does
 * not duplicate the SourceDescriptor.
 */
import {
  hasOnlyAllowedKeys,
  isMeaningfulText,
  isNonEmptyStringArray,
  isPositiveSafeInteger,
  isRecord,
} from "../validation/primitives";
import { isNormalizedDocument } from "./document";
import type { NormalizedDocument } from "./document";

export const CONTEXT_TASK_KIND = "context" as const;
export const GITHUB_FIX_ISSUE_TASK_KIND = "github_fix_issue" as const;

export interface ContextAgentTask {
  kind: typeof CONTEXT_TASK_KIND;
}

/**
 * `sourceAcceptanceCriteria` semantics (source truth boundary):
 * - null  → the source did NOT explicitly provide acceptance criteria
 * - string[] → criteria explicitly identified in the source (never empty)
 * Empty array is rejected to avoid conflating "none" with "recognized but empty".
 */
export interface GitHubFixIssueAgentTask {
  kind: typeof GITHUB_FIX_ISSUE_TASK_KIND;
  repository: string;
  issueNumber: number;
  sourceAcceptanceCriteria: string[] | null;
}

export type AgentTask = ContextAgentTask | GitHubFixIssueAgentTask;

export function isContextAgentTask(value: unknown): value is ContextAgentTask {
  return isRecord(value) && hasOnlyAllowedKeys(value, ["kind"]) && value.kind === CONTEXT_TASK_KIND;
}

export function isGitHubFixIssueAgentTask(value: unknown): value is GitHubFixIssueAgentTask {
  const repositoryParts =
    typeof value === "object" && value !== null && "repository" in value && typeof value.repository === "string"
      ? value.repository.split("/")
      : [];
  const repositoryIsValid =
    repositoryParts.length === 2 && repositoryParts.every(isMeaningfulText);
  return (
    isRecord(value) &&
    hasOnlyAllowedKeys(value, ["kind", "repository", "issueNumber", "sourceAcceptanceCriteria"]) &&
    value.kind === GITHUB_FIX_ISSUE_TASK_KIND &&
    repositoryIsValid &&
    isPositiveSafeInteger(value.issueNumber) &&
    (value.sourceAcceptanceCriteria === null ||
      isNonEmptyStringArray(value.sourceAcceptanceCriteria))
  );
}

export function isAgentTask(value: unknown): value is AgentTask {
  return isContextAgentTask(value) || isGitHubFixIssueAgentTask(value);
}

export const AGENT_PACKAGE_SCHEMA_VERSION = 1 as const;

export interface AgentPackage {
  schemaVersion: typeof AGENT_PACKAGE_SCHEMA_VERSION;
  document: NormalizedDocument;
  task: AgentTask;
  /** Page2Agent-generated instructions, kept strictly separate from document.blocks. */
  page2AgentInstructions: string[];
}

const AGENT_PACKAGE_KEYS = ["schemaVersion", "document", "task", "page2AgentInstructions"];

export function isAgentPackage(value: unknown): value is AgentPackage {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, AGENT_PACKAGE_KEYS)) {
    return false;
  }
  return (
    value.schemaVersion === AGENT_PACKAGE_SCHEMA_VERSION &&
    isNormalizedDocument(value.document) &&
    isAgentTask(value.task) &&
    Array.isArray(value.page2AgentInstructions) &&
    value.page2AgentInstructions.every(isMeaningfulText)
  );
}
