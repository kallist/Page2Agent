/**
 * User text selection capture (V1.1, spec §4.5).
 *
 * When the page already has a window.getSelection() selection, Page2Agent
 * can use it as a Selection Context without re-entering the Lens. The
 * selection is treated as plain text: block boundaries are recovered from
 * the browser's own toString() normalization (each block end becomes a line
 * break) — no HTML, no DOM cloning, no scripts.
 */
import { Page2AgentError, Page2AgentErrorCode } from "../../../core";
import type { ContentBlock, NormalizedDocument } from "../../../core";
import { buildSelectionDocument } from "../../../application/workbench";
import { normalizeInlineText } from "../../../shared/dom/text";

export interface UserSelectionResult {
  document: NormalizedDocument;
  excerpt: string;
  characters: number;
}

export interface SelectionContextDeps {
  window: Window;
}

/** True when a meaningful, non-collapsed user selection exists. */
export function hasUserTextSelection(deps: SelectionContextDeps): boolean {
  const selection = deps.window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const text = selection.toString().trim();
  return text.length > 0;
}

/** Normalized text of the current selection (empty when none). */
export function currentSelectionText(deps: SelectionContextDeps): string {
  return (deps.window.getSelection()?.toString() ?? "").trim();
}

/**
 * Capture the current selection as a fragment document.
 * Selection text is chunked on double line breaks (browser block
 * boundaries); single line breaks inside a chunk become spaces.
 */
export function captureUserTextSelection(
  deps: SelectionContextDeps,
  session: { captureId: string; url: string; capturedAt: string; pageTitle: string },
): UserSelectionResult {
  const text = currentSelectionText(deps);
  if (text.length === 0) {
    throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
  }
  const chunks = text.split(/\r?\n{2,}/).map((chunk) => chunk.replace(/\s*\r?\n\s*/g, " ").trim());
  const blocks: ContentBlock[] = chunks
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => ({ type: "paragraph", text: chunk }));
  if (blocks.length === 0) {
    throw new Page2AgentError(Page2AgentErrorCode.NO_CONTENT_FOUND);
  }
  const excerpt = excerptOf(text);
  const title = `Selection: “${excerpt}”`;
  const document = buildSelectionDocument({
    captureId: session.captureId,
    url: session.url,
    capturedAt: session.capturedAt,
    title,
    adapterId: "context-lens",
    scope: "text-selection",
    blocks,
  });
  return { document, excerpt, characters: text.length };
}

export function excerptOf(text: string, max = 96): string {
  const normalized = normalizeInlineText(text);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}
