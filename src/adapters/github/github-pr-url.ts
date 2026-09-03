/**
 * Strict GitHub Pull Request URL parser. Identity facts
 * (owner/repo/prNumber) always come from the URL, never from page DOM.
 *
 * Contract: `https://github.com/{owner}/{repo}/pull/{number}`
 * - https only; host must be exactly `github.com` (no lookalikes/subdomains).
 * - query, fragment and trailing slash are allowed.
 * - issues, compare paths and extra path segments are rejected.
 */

export interface GitHubPullRequestIdentity {
  owner: string;
  repo: string;
  prNumber: number;
}

const GITHUB_PULL_REQUEST_HOST = "github.com";

export function parseGitHubPullRequestUrl(rawUrl: string): GitHubPullRequestIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null; // malformed: never crash, never trust
  }
  if (url.protocol !== "https:" || url.hostname !== GITHUB_PULL_REQUEST_HOST) {
    return null;
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 4 || segments[2] !== "pull") {
    return null;
  }
  const [owner, repo, , numberSegment] = segments;
  let decodedOwner: string;
  let decodedRepo: string;
  try {
    decodedOwner = decodeURIComponent(owner);
    decodedRepo = decodeURIComponent(repo);
  } catch {
    return null;
  }
  if (decodedOwner.length === 0 || decodedRepo.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(numberSegment)) {
    return null;
  }
  const prNumber = Number(numberSegment);
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    return null;
  }
  return { owner: decodedOwner, repo: decodedRepo, prNumber };
}
