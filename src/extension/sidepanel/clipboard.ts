/**
 * Clipboard delivery (Side Panel infrastructure). Runs directly from the user
 * action to preserve user activation; failures surface as rejections which the
 * UI maps to friendly CLIPBOARD_FAILED feedback.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
