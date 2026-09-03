/**
 * Context Lens materialization — turns retained page picks into a validated
 * fragment NormalizedDocument plus per-region metadata for receipts.
 *
 * GitHub fidelity: when every picked element lives inside an issue/PR body,
 * the GitHub region converter runs (task lists, checkboxes, clone-only
 * mutation). Everything else converts with the generic semantic walker and
 * records the Context Lens adapter identity. Classification is honest: the
 * adapter id says exactly which converter ran.
 */
import { Page2AgentError, Page2AgentErrorCode, countDocumentCharacters, MAX_DOCUMENT_CHARACTERS } from "../../../core";
import type { ContentBlock, NormalizedDocument } from "../../../core";
import { domToBlocks } from "../../../shared/dom/blocks";
import { githubRegionElementsToBlocks, isInsideGitHubBodyRegion } from "../../../adapters/github";
import { buildSelectionDocument } from "../../../application/workbench";
import type { LensRegion } from "./semantic-region";
import { regionLabel } from "./semantic-region";

export interface LensRegionMeta {
  label: string;
  tokens: number;
  characters: number;
}

export interface LensMaterialization {
  document: NormalizedDocument;
  regions: LensRegionMeta[];
}

export interface MaterializationSession {
  captureId: string;
  url: string;
  capturedAt: string;
}

export interface MaterializeLensInput {
  session: MaterializationSession;
  regions: readonly LensRegion[];
}

/**
 * Build the combined fragment document for the retained picks. Returns null
 * when nothing is picked (the caller shows the empty hint instead).
 */
export function materializeLensRegions(input: MaterializeLensInput): LensMaterialization | null {
  const { session, regions } = input;
  if (regions.length === 0) {
    return null;
  }
  const allInsideGitHubBody = regions.every((region) =>
    region.elements.every((element) => isInsideGitHubBodyRegion(element)),
  );

  const blocks: ContentBlock[] = [];
  const regionMeta: LensRegionMeta[] = [];
  for (const region of regions) {
    const regionBlocks = allInsideGitHubBody
      ? githubRegionElementsToBlocks(region.elements, session.url)
      : genericElementsToBlocks(region.elements, session.url);
    blocks.push(...regionBlocks);
    const label = regionLabel(region);
    regionMeta.push({
      label,
      tokens: region.estimatedTokens,
      characters: (region.elements.reduce((sum, element) => sum + (element.textContent ?? "").length, 0)),
    });
  }

  const document = buildSelectionDocument({
    captureId: session.captureId,
    url: session.url,
    capturedAt: session.capturedAt,
    title: titleForPicks(regions),
    adapterId: allInsideGitHubBody ? "github-issue" : "context-lens",
    scope: "selection",
    blocks,
  });
  // buildSelectionDocument validates structure + size; double-check size
  // after concatenation (single-region caps do not sum up to the limit).
  if (countDocumentCharacters(document) > MAX_DOCUMENT_CHARACTERS) {
    throw new Page2AgentError(Page2AgentErrorCode.CONTENT_TOO_LARGE);
  }
  return { document, regions: regionMeta };
}

function titleForPicks(regions: readonly LensRegion[]): string {
  for (const region of regions) {
    const label = regionLabel(region);
    if (label.length > 0) {
      return label.slice(0, 160);
    }
  }
  return "Selected sections";
}

function genericElementsToBlocks(elements: readonly Element[], sourceUrl: string): ContentBlock[] {
  if (elements.length === 0) {
    return [];
  }
  const container = elements[0].ownerDocument.createElement("div");
  for (const element of elements) {
    container.appendChild(element.cloneNode(true));
  }
  return domToBlocks(container, sourceUrl);
}
