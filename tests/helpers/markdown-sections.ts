/**
 * Small helper for asserting on Markdown sections produced by Page2Agent.
 */

/** Extract the body of a `## <heading>` section (until the next `## `). */
export function extractMarkdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex((line) => line === `## ${heading}`);
  if (startIndex === -1) {
    return null;
  }
  const body: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}
