/**
 * Strict GitHub Issue URL parser. Identity facts (owner/repo/issueNumber)
 * always come from the URL, never from page DOM.
 *
 * Contract: `https://github.com/{owner}/{repo}/issues/{number}`
 * - https only; host must be exactly `github.com` (no lookalikes/subdomains).
 * - query, fragment and trailing slash are allowed.
 * - pull requests, issue lists and extra path segments are rejected.
 */

export interface GitHubIssueIdentity {
  owner: string;
  repo: string;
  issueNumber: number;
}

const GITHUB_ISSUE_HOST = "github.com";

export function parseGitHubIssueUrl(rawUrl: string): GitHubIssueIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null; // malformed: never crash, never trust
  }
  if (url.protocol !== "https:" || url.hostname !== GITHUB_ISSUE_HOST) {
    return null;
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 4 || segments[2] !== "issues") {
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
  const issueNumber = Number(numberSegment);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return null;
  }
  return { owner: decodedOwner, repo: decodedRepo, issueNumber };
}
