/**
 * Context Lens — semantic region resolution (V1.1).
 *
 * The lens prefers *content blocks*, never raw DOM wrappers: hovering
 * anywhere in a code fence selects the <pre>, hovering inside a GitHub
 * comment selects its nearest markdown section, hovering in flat docs picks
 * the heading-anchored run of siblings up to the next heading.
 *
 * Resolution is read-only: it never mutates the page, never sets attributes,
 * and never touches class names. Overlays live OUTSIDE the page tree (shadow
 * root appended by the engine), so DOM immutability is structural.
 */
import { estimateTextTokens } from "../../../core";
import { getNormalizedText } from "../../../shared/dom/text";

/** Tags handled atomically: the whole element is one pickable region. */
const ATOMIC_TAGS = new Set([
  "PRE",
  "TABLE",
  "BLOCKQUOTE",
  "FIGURE",
  "IMG",
  "UL",
  "OL",
]);

/** Sibling tags that stop run expansion (structural boundaries). */
const RUN_BOUNDARY_TAGS = new Set([
  "HR",
  "NAV",
  "ASIDE",
  "FOOTER",
  "HEADER",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "FORM",
]);

const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "SVG",
  "MATH",
  "HEAD",
  "NAV",
  "ASIDE",
  "FOOTER",
  "FORM",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

export type LensRegionKind =
  | "code"
  | "table"
  | "quote"
  | "list"
  | "image"
  | "figure"
  | "section"
  | "heading"
  | "text"
  | "article";

export interface LensRegion {
  /** Ordered root elements that make up the region (read-only references). */
  elements: Element[];
  kind: LensRegionKind;
  /** Short human label shown on the hover chip. */
  label: string;
  /** Heading text that anchors this region, when one is observable. */
  heading?: string;
  /** Estimated tokens of the visible text (heuristic, labeled estimated). */
  estimatedTokens: number;
}

export const MAX_REGION_TEXT_CHARACTERS = 60_000;

/**
 * Resolve the semantic region under `target`.
 * Pure: read-only DOM traversal, deterministic, no timers, no mutation.
 */
export function resolveRegionUnder(target: Element): LensRegion | null {
  const chain = ancestorChain(target);
  if (chain.length === 0) {
    return null;
  }

  // 1. Atomic block: the whole pre/table/blockquote/figure/list is the pick.
  const atomic = chain.find((element) => ATOMIC_TAGS.has(element.tagName));
  if (atomic !== undefined && isVisibleCandidate(atomic)) {
    return regionForSingleElement(atomic);
  }

  // 2. Flat sibling run inside the nearest block container. Hovering a
  //    heading picks the section it introduces (heading + content until the
  //    next heading); hovering content picks its heading-anchored run.
  return resolveSiblingRun(chain);
}

function ancestorChain(target: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = target;
  while (current !== null && current.tagName !== "BODY" && current.tagName !== "HTML") {
    if (!SKIPPED_TAGS.has(current.tagName)) {
      chain.push(current);
    }
    current = current.parentElement;
  }
  return chain;
}

function isVisibleCandidate(element: Element): boolean {
  const text = (element.textContent ?? "").trim();
  if (text.length === 0) {
    return false;
  }
  // Structural shells with only chrome-like children are not content.
  const directChildren = [...element.children];
  if (
    directChildren.length > 0 &&
    directChildren.every((child) => SKIPPED_TAGS.has(child.tagName) || child.tagName === "A")
  ) {
    return false;
  }
  return true;
}

function regionForSingleElement(element: Element): LensRegion {
  const kind = kindOfElement(element);
  const label = labelOfElement(element, kind);
  return {
    elements: [element],
    kind,
    label,
    ...(kind === "heading" ? { heading: label } : {}),
    estimatedTokens: estimateRegionTokens([element]),
  };
}

function resolveSiblingRun(chain: Element[]): LensRegion | null {
  // The run lives among the element children of the deepest container that
  // has at least one direct block-ish child.
  const target = chain[0];
  const container = chain.find((ancestor) =>
    [...ancestor.children].some((child) => isBlockLikeChild(child)),
  );
  if (container === undefined) {
    return null;
  }
  const anchor = nearestDirectChild(container, target);
  if (anchor === null) {
    return null;
  }
  if (!isBlockLikeChild(anchor)) {
    // Inline target inside a text wrapper: treat the wrapper as the run root.
    const wrapper = anchor;
    if ((wrapper.textContent ?? "").trim().length === 0) {
      return null;
    }
    return {
      elements: [wrapper],
      kind: "text",
      label: labelOfElement(wrapper, "text"),
      estimatedTokens: estimateRegionTokens([wrapper]),
    };
  }

  const children = [...container.children];
  const anchorIndex = children.indexOf(anchor);
  const elements: Element[] = [];
  let textBudget = MAX_REGION_TEXT_CHARACTERS;

  const startsRun = (element: Element): boolean => {
    return (
      isBlockLikeChild(element) &&
      !RUN_BOUNDARY_TAGS.has(element.tagName) &&
      !(element.tagName === "HR")
    );
  };

  if (isHeadingElement(anchor)) {
    // A heading picks the section it introduces: the heading itself plus the
    // following siblings up to the next heading.
    elements.push(anchor);
    for (let index = anchorIndex + 1; index < children.length; index += 1) {
      const child = children[index];
      if (RUN_BOUNDARY_TAGS.has(child.tagName)) {
        break;
      }
      if (isHeadingElement(child)) {
        break;
      }
      if (!startsRun(child)) {
        continue;
      }
      if (textBudget <= 0) {
        break;
      }
      textBudget -= (child.textContent ?? "").length;
      elements.push(child);
    }
  } else {
    for (let index = anchorIndex; index >= 0; index -= 1) {
      const child = children[index];
      if (child === anchor) {
        if (startsRun(child)) {
          textBudget -= (child.textContent ?? "").length;
          elements.unshift(child);
        }
        continue;
      }
      if (!startsRun(child) || isHeadingElement(child)) {
        break; // runs never cross a heading backwards
      }
      if (textBudget <= 0) {
        break;
      }
      textBudget -= (child.textContent ?? "").length;
      elements.unshift(child);
    }
    for (let index = anchorIndex + 1; index < children.length; index += 1) {
      const child = children[index];
      if (RUN_BOUNDARY_TAGS.has(child.tagName)) {
        break;
      }
      if (isHeadingElement(child)) {
        break;
      }
      if (!startsRun(child)) {
        continue;
      }
      if (textBudget <= 0) {
        break;
      }
      textBudget -= (child.textContent ?? "").length;
      elements.push(child);
    }
  }

  if (elements.length === 0) {
    return null;
  }

  const precedingHeading = headingBefore(container, anchorIndex);
  const single = elements.length === 1;
  const firstElement = elements[0];
  let kind: LensRegionKind = single ? kindOfElement(firstElement) : "section";
  if (kind === "heading") {
    kind = "section"; // a heading run is a section of following content
  }
  const firstIsHeading = isHeadingElement(firstElement);
  const ownHeading = firstIsHeading ? getNormalizedText(firstElement) : "";
  const anchorHeading = ownHeading.length > 0 ? ownHeading : undefined;
  const label = anchorHeading ?? precedingHeading ?? `${labelOfKind(kind)} block`;
  return {
    elements,
    kind,
    label,
    ...(anchorHeading !== undefined
      ? { heading: anchorHeading }
      : precedingHeading !== undefined
        ? { heading: precedingHeading }
        : {}),
    estimatedTokens: estimateRegionTokens(elements),
  };
}

function nearestDirectChild(container: Element, descendant: Element): Element | null {
  let current: Element | null = descendant;
  while (current !== null && current.parentElement !== container) {
    current = current.parentElement;
  }
  return current;
}

/** Container tag heuristic for framework-wrapped heading sections. */

function isBlockLikeChild(element: Element): boolean {
  const tag = element.tagName;
  if (SKIPPED_TAGS.has(tag) || RUN_BOUNDARY_TAGS.has(tag)) {
    return false;
  }
  if (ATOMIC_TAGS.has(tag) || isHeadingElement(element) || tag === "P") {
    return true;
  }
  if (element.children.length === 0) {
    return false;
  }
  return [...element.children].some((child) => isBlockLikeChild(child));
}

function isHeadingElement(element: Element): boolean {
  return /^H[1-6]$/.test(element.tagName);
}

function findFirstHeading(root: Element): string | undefined {
  const heading = root.querySelector("h1, h2, h3, h4, h5, h6");
  const text = heading === null ? "" : getNormalizedText(heading);
  return text.length > 0 ? text : undefined;
}

/** Nearest heading that appears BEFORE the anchor within the same container. */
function headingBefore(container: Element, anchorIndex: number): string | undefined {
  const children = [...container.children];
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (isHeadingElement(child)) {
      const text = getNormalizedText(child);
      return text.length > 0 ? text : undefined;
    }
    if (RUN_BOUNDARY_TAGS.has(child.tagName)) {
      break;
    }
  }
  return undefined;
}

export function kindOfElement(element: Element): LensRegionKind {
  const tag = element.tagName;
  if (tag === "PRE") {
    return "code";
  }
  if (tag === "TABLE") {
    return "table";
  }
  if (tag === "BLOCKQUOTE") {
    return "quote";
  }
  if (tag === "UL" || tag === "OL") {
    return "list";
  }
  if (tag === "IMG") {
    return "image";
  }
  if (tag === "FIGURE") {
    return "figure";
  }
  if (tag === "ARTICLE") {
    return "article";
  }
  if (isHeadingElement(element)) {
    return "heading";
  }
  if (tag === "SECTION" || tag === "DIV") {
    return "section";
  }
  return "text";
}

function labelOfKind(kind: LensRegionKind): string {
  switch (kind) {
    case "code":
      return "Code";
    case "table":
      return "Table";
    case "quote":
      return "Quote";
    case "list":
      return "List";
    case "image":
      return "Image";
    case "figure":
      return "Figure";
    case "section":
      return "Section";
    case "heading":
      return "Heading";
    case "article":
      return "Article";
    default:
      return "Text";
  }
}

function labelOfElement(element: Element, kind: LensRegionKind): string {
  if (isHeadingElement(element)) {
    const text = getNormalizedText(element);
    return text.length > 0 ? text.slice(0, 80) : labelOfKind(kind);
  }
  // Structural kinds are labeled by their kind, not their raw content.
  if (
    kind === "code" ||
    kind === "table" ||
    kind === "list" ||
    kind === "image" ||
    kind === "figure"
  ) {
    return labelOfKind(kind);
  }
  const text = getNormalizedText(element);
  if (text.length > 0 && text.length <= 64) {
    return text;
  }
  if (kind === "section" || kind === "article") {
    return findFirstHeading(element) ?? labelOfKind(kind);
  }
  return labelOfKind(kind);
}

/** Heuristic estimate over visible text — always labeled "estimated". */
export function estimateRegionTokens(elements: readonly Element[]): number {
  const text = elements.map((element) => element.textContent ?? "").join("\n");
  return estimateTextTokens(text);
}

/** Human label used for receipts when a pick is materialized. */
export function regionLabel(region: LensRegion): string {
  return region.heading ?? region.label;
}
