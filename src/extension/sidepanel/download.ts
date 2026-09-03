/**
 * Local file downloads via Blob + object URL + anchor (no downloads
 * permission). Object URLs are revoked and the anchor removed after click.
 */
export function downloadText(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadMarkdown(filename: string, content: string): void {
  downloadText(filename, content, "text/markdown");
}

export function downloadJson(filename: string, content: string): void {
  downloadText(filename, content, "application/json");
}
