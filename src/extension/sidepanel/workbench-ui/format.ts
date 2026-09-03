/**
 * Side Panel V1.1 — display vocabulary (pure UI helpers).
 * Labels/icons stay consistent with domain role/scope semantics.
 */
import type { ContextRole, RecipeId } from "../../../core";

export const RECIPE_ICONS: Record<RecipeId, string> = {
  learn: "🧠",
  compare: "⚖️",
  verify: "🔍",
  build: "🛠️",
  fix: "🐛",
};

export const RECIPE_TITLES: Record<RecipeId, string> = {
  learn: "Learn",
  compare: "Compare",
  verify: "Verify",
  build: "Build",
  fix: "Fix",
};

export const ROLE_ICONS: Record<ContextRole, string> = {
  task: "🎯",
  reference: "📘",
  evidence: "🧪",
  example: "💡",
  selection: "✂️",
};

export const ROLE_TITLES: Record<ContextRole, string> = {
  task: "Task",
  reference: "Reference",
  evidence: "Evidence",
  example: "Example",
  selection: "Selection",
};

export const SOURCE_KIND_LABELS: Record<string, string> = {
  web: "Web Page",
  github_issue: "GitHub Issue",
  github_pull_request: "GitHub Pull Request",
};

export const ITEM_SCOPE_LABELS: Record<string, string> = {
  "full-page": "Full page",
  selection: "Selected sections",
  "text-selection": "Text selection",
};

export function adapterLabel(adapter: { id: string; name: string } | undefined): string {
  return adapter?.name ?? "Unknown";
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatEstimate(tokens: number): string {
  return `~${formatNumber(tokens)} estimated tokens`;
}

export function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function statusLabel(
  status: "clean" | "has-unknowns" | "has-warnings",
): string {
  switch (status) {
    case "clean":
      return "Clean";
    case "has-unknowns":
      return "Unknowns";
    case "has-warnings":
      return "Warnings";
    default:
      return status;
  }
}
