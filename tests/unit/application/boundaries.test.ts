import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const applicationDir = fileURLToPath(new URL("../../../src/application", import.meta.url));

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

describe("application layer architecture boundary", () => {
  const files = collectTsFiles(applicationDir);
  it("discovers application source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports React, react-dom, or extension runtime code", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (
          /(from|import)\s+["']react(-dom)?["']/.test(line) ||
          /(from|import)\s+["'](?:\.\.\/)+extension\//.test(line) ||
          /(from|import)\s+["']src\/extension\//.test(line)
        ) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never references the chrome runtime API", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (/chrome\./.test(line)) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
