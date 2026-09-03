/**
 * Workbench delivery serializers (V1.1) — deterministic multi-source text.
 *
 * Agent output (Copy for Agent) partitions generated task facts/instructions
 * from SOURCE content; Markdown output carries only the source partition.
 * Both derive from one validated TaskSpec — Markdown is a delivery format,
 * never a source of truth. Everything is byte-deterministic for a given spec.
 */
import { escapeMarkdownText } from "../../core/serialize";
import type { TaskSpec, TaskSpecSource } from "../../core";
import { sanitizeBaseName } from "../delivery/filename";

export const SOURCE_TYPE_LABELS: Record<TaskSpecSource["type"], string> = {
  web: "Web Page",
  github_issue: "GitHub Issue",
  github_pull_request: "GitHub Pull Request",
};

export const ROLE_LABELS: Record<TaskSpecSource["role"], string> = {
  task: "Task",
  reference: "Reference",
  evidence: "Evidence",
  example: "Example",
  selection: "Selection",
};

export const SCOPE_LABELS: Record<TaskSpecSource["scope"], string> = {
  full_page: "Full page",
  selected_sections: "Selected sections",
  text_selection: "Text selection",
};

export function serializeAgentContext(spec: TaskSpec): string {
  const sections: string[] = [];

  sections.push("# Page2Agent Task");
  sections.push(serializeTaskBlock(spec));

  sections.push("## Task Instructions");
  sections.push(serializeInstructions(spec));

  sections.push(`## Sources`);
  sections.push(
    spec.sources.map((source, index) => serializeSourceBlock(source, index)).join("\n\n"),
  );

  return sections.join("\n\n") + "\n";
}

/** Source-only partition (used for the Markdown preview and downloads). */
export function serializeSourcesMarkdown(spec: TaskSpec): string {
  return spec.sources.map((source, index) => serializeSourceBlock(source, index)).join("\n\n") + "\n";
}

function serializeTaskBlock(spec: TaskSpec): string {
  const lines: string[] = [];
  lines.push(`Recipe: ${titleCase(spec.recipe)}`);
  lines.push(`Task kind: ${spec.task.kind}`);
  lines.push(`Title: ${escapeMarkdownText(spec.task.title)}`);
  if (spec.target.repository !== null) {
    lines.push(`Target repository: ${spec.target.repository}`);
  }
  lines.push(
    `Sources: ${spec.sources.length} · ~${spec.estimates.totalEstimatedTokens.toLocaleString("en-US")} estimated tokens`,
  );
  if (spec.unknowns.length > 0) {
    lines.push("");
    lines.push("Unknowns:");
    for (const unknown of spec.unknowns) {
      lines.push(`- ${escapeMarkdownText(unknown)}`);
    }
  }
  return lines.join("\n");
}

function serializeInstructions(spec: TaskSpec): string {
  const bullets = spec.generated.instructions.map((instruction) => `- ${instruction}`);
  return bullets.join("\n");
}

function serializeSourceBlock(source: TaskSpecSource, index: number): string {
  const heading = `### Source ${index + 1} — ${escapeMarkdownText(source.title)}`;

  const meta: string[] = [];
  meta.push(`Role: ${ROLE_LABELS[source.role]}${source.isPrimary ? " · Primary" : ""}`);
  meta.push(`Type: ${SOURCE_TYPE_LABELS[source.type]}`);
  if (source.adapter !== undefined) {
    meta.push(`Adapter: ${source.adapter.name}`);
  }
  meta.push(`URL: ${source.url}`);
  meta.push(`Captured At: ${source.capturedAt}`);
  meta.push(`Capture: ${SCOPE_LABELS[source.scope]}`);
  if (source.selection !== undefined && source.selection.labels.length > 0) {
    meta.push(`Selection: ${source.selection.labels.join(" · ")}`);
  }
  meta.push(`~${source.tokenEstimate.tokens.toLocaleString("en-US")} estimated tokens`);

  const content = source.contentMarkdown.replace(/\s+$/, "");
  return `${heading}\n\n${meta.join("\n")}\n\n${content}`;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

/** Deterministic download filename for the TaskSpec JSON. */
export function buildTaskSpecFilename(spec: TaskSpec): string {
  const base = sanitizeBaseName(spec.task.title) || "page2agent-task";
  return `${base}-taskspec.json`;
}
