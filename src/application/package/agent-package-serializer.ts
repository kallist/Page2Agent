/**
 * AgentPackageSerializer — agent-ready context serialization (application
 * layer). Pure, deterministic, provider-neutral.
 *
 * Section order is fixed and tested:
 *   Page2Agent Agent Instructions → Source → Title/Issue Title → Content/
 *   Issue Body → Source Acceptance Criteria (GitHub issues only).
 *
 * Generated instructions come FIRST so the target agent sees the trust
 * boundary before any source content. Source Acceptance Criteria always come
 * from the package's task fact, never re-extracted, never invented.
 */
import { serializeContentBlocks } from "../../core/serialize";
import type { AgentPackage, AgentTask } from "../../core";

const NOT_PROVIDED_SENTINEL = "Not explicitly provided in source.";

export function serializeAgentPackage(agentPackage: AgentPackage): string {
  const sections: string[] = [];

  sections.push("# Page2Agent Context");

  sections.push(section("## Page2Agent Agent Instructions", serializeInstructions(agentPackage)));

  sections.push(section("## Source", serializeSourceSection(agentPackage)));

  const titleHeading = agentPackage.task.kind === "github_fix_issue" ? "## Issue Title" : "## Title";
  sections.push(section(titleHeading, agentPackage.document.metadata.title));

  const contentHeading =
    agentPackage.task.kind === "github_fix_issue" ? "## Issue Body" : "## Content";
  sections.push(section(contentHeading, serializeContentBlocks(agentPackage.document.blocks)));

  if (agentPackage.task.kind === "github_fix_issue") {
    sections.push(section("## Source Acceptance Criteria", serializeAcceptanceCriteria(agentPackage.task)));
  }

  return sections.join("\n\n") + "\n";
}

function section(heading: string, body: string): string {
  return `${heading}\n\n${body.replace(/\n+$/, "")}`;
}

function serializeInstructions(agentPackage: AgentPackage): string {
  return agentPackage.page2AgentInstructions.map((instruction) => `- ${instruction}`).join("\n");
}

function serializeSourceSection(agentPackage: AgentPackage): string {
  const { document } = agentPackage;
  const lines: string[] = [];
  switch (document.source.kind) {
    case "web":
      lines.push("Type: Web Page");
      lines.push(`URL: ${document.source.url}`);
      if (document.source.canonicalUrl !== undefined) {
        lines.push(`Canonical URL: ${document.source.canonicalUrl}`);
      }
      break;
    case "github_issue":
      lines.push("Type: GitHub Issue");
      lines.push(`Repository: ${document.source.owner}/${document.source.repo}`);
      lines.push(`Issue: #${document.source.issueNumber}`);
      lines.push(`URL: ${document.source.url}`);
      if (document.source.canonicalUrl !== undefined) {
        lines.push(`Canonical URL: ${document.source.canonicalUrl}`);
      }
      if (document.source.labels !== undefined) {
        lines.push(`Labels: ${document.source.labels.join(", ")}`);
      }
      break;
    case "github_pull_request":
      lines.push("Type: GitHub Pull Request");
      lines.push(`Repository: ${document.source.owner}/${document.source.repo}`);
      lines.push(`Pull Request: #${document.source.prNumber}`);
      lines.push(`URL: ${document.source.url}`);
      if (document.source.state !== undefined) {
        lines.push(`State: ${document.source.state}`);
      }
      if (document.source.baseBranch !== undefined) {
        lines.push(`Base: ${document.source.baseBranch}`);
      }
      if (document.source.headBranch !== undefined) {
        lines.push(`Head: ${document.source.headBranch}`);
      }
      if (document.source.labels !== undefined) {
        lines.push(`Labels: ${document.source.labels.join(", ")}`);
      }
      break;
    default:
      return assertNeverSource(document.source);
  }
  if (document.metadata.author !== undefined) {
    lines.push(`Author: ${document.metadata.author}`);
  }
  if (document.metadata.publishedAt !== undefined) {
    lines.push(`Published At: ${document.metadata.publishedAt}`);
  }
  lines.push(`Captured At: ${document.metadata.capturedAt}`);
  return lines.join("\n");
}

function serializeAcceptanceCriteria(task: Extract<AgentTask, { kind: "github_fix_issue" }>): string {
  if (task.sourceAcceptanceCriteria === null) {
    return NOT_PROVIDED_SENTINEL;
  }
  // Criteria already carry task-list markers when the source used them.
  return task.sourceAcceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
}

function assertNeverSource(source: never): never {
  throw new Error(`Unknown source kind: ${JSON.stringify(source)}`);
}
