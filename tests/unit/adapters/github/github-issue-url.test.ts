import { describe, expect, it } from "vitest";
import { parseGitHubIssueUrl } from "../../../../src/adapters/github";

describe("parseGitHubIssueUrl", () => {
  it("parses a valid issue URL", () => {
    expect(parseGitHubIssueUrl("https://github.com/openai/example/issues/123")).toEqual({
      owner: "openai",
      repo: "example",
      issueNumber: 123,
    });
  });

  it("accepts query strings, fragments and trailing slashes", () => {
    expect(
      parseGitHubIssueUrl(
        "https://github.com/openai/example/issues/123?notification_referrer_id=NT_kwDOA",
      ),
    ).toEqual({ owner: "openai", repo: "example", issueNumber: 123 });
    expect(parseGitHubIssueUrl("https://github.com/openai/example/issues/123#issuecomment-5")).toEqual(
      { owner: "openai", repo: "example", issueNumber: 123 },
    );
    expect(parseGitHubIssueUrl("https://github.com/openai/example/issues/123/")).toEqual({
      owner: "openai",
      repo: "example",
      issueNumber: 123,
    });
  });

  it("decodes percent-encoded path segments", () => {
    expect(parseGitHubIssueUrl("https://github.com/acme%20corp/my-repo/issues/1")).toEqual({
      owner: "acme corp",
      repo: "my-repo",
      issueNumber: 1,
    });
  });

  it("rejects pull requests", () => {
    expect(parseGitHubIssueUrl("https://github.com/a/b/pull/123")).toBeNull();
  });

  it("rejects non-issue paths", () => {
    expect(parseGitHubIssueUrl("https://github.com/a/b")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com/a/b/issues")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com/a/b/issues/")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com/a/b/issues/123/extra")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com/a/b/issues/123/comments")).toBeNull();
  });

  it("rejects invalid issue numbers", () => {
    for (const number of ["0", "-1", "abc", "1.5", "999999999999999999999"]) {
      expect(parseGitHubIssueUrl(`https://github.com/a/b/issues/${number}`)).toBeNull();
    }
  });

  it("rejects non-GitHub and lookalike hosts", () => {
    expect(parseGitHubIssueUrl("https://example.com/a/b/issues/123")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com.evil.example/a/b/issues/123")).toBeNull();
    expect(parseGitHubIssueUrl("https://evilgithub.com/a/b/issues/123")).toBeNull();
    expect(parseGitHubIssueUrl("https://evil.github.com/a/b/issues/123")).toBeNull();
    expect(parseGitHubIssueUrl("https://www.github.com/a/b/issues/123")).toBeNull();
  });

  it("requires https (no http)", () => {
    expect(parseGitHubIssueUrl("http://github.com/a/b/issues/123")).toBeNull();
  });

  it("rejects malformed input without crashing", () => {
    expect(parseGitHubIssueUrl("not a url")).toBeNull();
    expect(parseGitHubIssueUrl("")).toBeNull();
  });
});
