/**
 * Shared site-neutral code block extraction + lightweight language hint
 * detection. Cleanup is conservative and site-neutral: copy buttons,
 * aria-hidden decorative nodes, and clearly marked line-number gutters are
 * removed. Mutation is safe: these functions only ever run on cloned or
 * detached DOM.
 */
import type { CodeBlock } from "../../core";

const LANGUAGE_CLASS_PATTERN =
  /^(?:language|lang|highlight-source)-([a-z0-9][a-z0-9+#_-]*)$/i;

const LINE_NUMBER_MARKER = /line-?number/i;

/**
 * Detect a language hint (first match wins). Sources:
 * 1. the nested <code> element's class,
 * 2. the <pre> element's class,
 * 3. the <pre> parent's class (common syntax-highlighter convention, e.g.
 *    GitHub's `highlight highlight-source-python` wrapper).
 */
export function detectLanguageHint(
  codeElement: Element | null,
  preElement: Element,
): string | undefined {
  const classSources = [
    codeElement?.getAttribute("class") ?? "",
    preElement.getAttribute("class") ?? "",
    preElement.parentElement?.getAttribute("class") ?? "",
  ];
  for (const className of classSources) {
    for (const token of className.split(/\s+/)) {
      const match = LANGUAGE_CLASS_PATTERN.exec(token);
      if (match === null) {
        continue;
      }
      const hint = match[1].trim().toLowerCase();
      if (hint.length > 0) {
        return hint;
      }
    }
  }
  return undefined;
}

function isLineNumberUi(element: Element): boolean {
  const className = element.getAttribute("class") ?? "";
  const id = element.getAttribute("id") ?? "";
  const dataAttributeValues = [...element.attributes]
    .filter((attribute) => attribute.name.startsWith("data-"))
    .map((attribute) => attribute.value)
    .join(" ");
  return (
    LINE_NUMBER_MARKER.test(className) ||
    LINE_NUMBER_MARKER.test(id) ||
    LINE_NUMBER_MARKER.test(dataAttributeValues)
  );
}

/**
 * Conservative code-UI cleanup inside a code/pre subtree. Removes only:
 * buttons, [aria-hidden="true"] nodes, and elements clearly marked as
 * line-number gutters. Never removes content based on generic class names.
 */
export function removeCodeUiNoise(root: Element): void {
  for (const button of [...root.querySelectorAll("button")]) {
    button.remove();
  }
  for (const hidden of [...root.querySelectorAll('[aria-hidden="true"]')]) {
    hidden.remove();
  }
  for (const lineNumber of [...root.querySelectorAll("span, div")].filter(isLineNumberUi)) {
    lineNumber.remove();
  }
}

/**
 * Strips exactly one leading and one trailing newline (the common artifact of
 * HTML formatting around <pre>). Everything else — indentation, blank lines,
 * backticks — is preserved verbatim.
 */
export function tidyCodeWhitespace(code: string): string {
  let result = code;
  if (result.startsWith("\n")) {
    result = result.slice(1);
  }
  if (result.endsWith("\n")) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Extract a CodeBlock from a <pre> element. Prefers a nested <code>; falls
 * back to the <pre> itself. Returns null for empty code.
 */
export function extractCodeBlock(preElement: Element): CodeBlock | null {
  const codeElement = preElement.querySelector("code");
  const contentRoot = codeElement ?? preElement;
  removeCodeUiNoise(contentRoot);
  const code = tidyCodeWhitespace(contentRoot.textContent ?? "");
  if (code.trim().length === 0) {
    return null;
  }
  const block: CodeBlock = { type: "code", code };
  const language = detectLanguageHint(codeElement, preElement);
  if (language !== undefined) {
    block.language = language;
  }
  return block;
}
