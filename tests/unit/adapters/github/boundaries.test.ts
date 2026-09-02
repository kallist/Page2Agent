import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const githubAdapterDir = fileURLToPath(new URL("../../../../src/adapters/github", import.meta.url));

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("github adapter architecture boundary", () => {
  const files = collectTsFiles(githubAdapterDir);
  it("discovers github adapter source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports React, react-dom, extension runtime, or chrome APIs", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (
          /(from|import)\s+["']react(-dom)?["']/.test(line) ||
          /(from|import)\s+["'](?:\.\.\/)+extension\//.test(line) ||
          /(from|import)\s+["']src\/extension\//.test(line) ||
          /chrome\./.test(line)
        ) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never depends on Readability (direct DOM strategy)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (line.includes("@mozilla/readability") || /new Readability/.test(line)) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no GitHub API / network / token code", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (
          /octokit|api\.github|graphql|fetch\(|Authorization|Bearer|GITHUB_TOKEN/i.test(line)
        ) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
