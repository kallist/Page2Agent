/**
 * Preview truncation helper. Pure; code-point safe (never splits surrogate
 * pairs); never mutates the source.
 */
export const PREVIEW_CHARACTER_LIMIT = 20_000;

export interface Preview {
  text: string;
  truncated: boolean;
}

export function createPreview(
  text: string,
  limit: number = PREVIEW_CHARACTER_LIMIT,
): Preview {
  const characters = [...text];
  if (characters.length <= limit) {
    return { text, truncated: false };
  }
  return { text: characters.slice(0, limit).join(""), truncated: true };
}

export const PREVIEW_TRUNCATED_MESSAGE =
  "Preview truncated. Copy and download use the full content.";
