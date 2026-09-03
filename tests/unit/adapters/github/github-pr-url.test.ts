import { describe, expect, it } from "vitest";
import { parseGitHubPullRequestUrl } from "../../../../src/adapters/github";

describe("parseGitHubPullRequestUrl", () => {
  it("parses a valid pull request URL", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/openai/example/pull/123")).toEqual({
      owner: "openai",
      repo: "example",
      prNumber: 123,
    });
  });

  it("accepts query strings, fragments and trailing slashes", () => {
    expect(
      parseGitHubPullRequestUrl("https://github.com/o/r/pull/7?diff=split"),
    ).toEqual({ owner: "o", repo: "r", prNumber: 7 });
    expect(parseGitHubPullRequestUrl("https://github.com/o/r/pull/7#issuecomment-9")).toEqual({
      owner: "o",
      repo: "r",
      prNumber: 7,
    });
    expect(parseGitHubPullRequestUrl("https://github.com/o/r/pull/7/")).toEqual({
      owner: "o",
      repo: "r",
      prNumber: 7,
    });
  });

  it("rejects issue URLs and other paths", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/a/b/issues/123")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com/a/b")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com/a/b/pull")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com/a/b/pull/7/extra")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com/a/b/compare/main...x")).toBeNull();
  });

  it("rejects invalid PR numbers", () => {
    for (const number of ["0", "-1", "abc", "1.5", "999999999999999999999"]) {
      expect(parseGitHubPullRequestUrl(`https://github.com/a/b/pull/${number}`)).toBeNull();
    }
  });

  it("rejects non-GitHub and lookalike hosts, http, and malformed input", () => {
    expect(parseGitHubPullRequestUrl("https://example.com/a/b/pull/1")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com.evil.example/a/b/pull/1")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://www.github.com/a/b/pull/1")).toBeNull();
    expect(parseGitHubPullRequestUrl("http://github.com/a/b/pull/1")).toBeNull();
    expect(parseGitHubPullRequestUrl("not a url")).toBeNull();
    expect(parseGitHubPullRequestUrl("")).toBeNull();
  });
});
