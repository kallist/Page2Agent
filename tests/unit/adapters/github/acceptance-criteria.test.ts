import { describe, expect, it } from "vitest";
import { extractSourceAcceptanceCriteria, isAcceptanceCriteriaHeading } from "../../../../src/adapters/github";
import type { ContentBlock } from "../../../../src/core";

function heading(text: string, level = 2): ContentBlock {
  return { type: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6, text };
}

function paragraph(text: string): ContentBlock {
  return { type: "paragraph", text };
}

function list(items: string[], ordered = false): ContentBlock {
  return { type: "list", ordered, items };
}

describe("isAcceptanceCriteriaHeading", () => {
  it("recognizes the strong vocabulary case-insensitively with optional colon", () => {
    expect(isAcceptanceCriteriaHeading("Acceptance Criteria")).toBe(true);
    expect(isAcceptanceCriteriaHeading("acceptance criteria")).toBe(true);
    expect(isAcceptanceCriteriaHeading("Acceptance Criteria:")).toBe(true);
    expect(isAcceptanceCriteriaHeading("Acceptance")).toBe(true);
    expect(isAcceptanceCriteriaHeading("Requirements")).toBe(true);
    expect(isAcceptanceCriteriaHeading("Definition of Done")).toBe(true);
  });

  it("does not fuzzy-match unrelated headings", () => {
    expect(isAcceptanceCriteriaHeading("Things we'd like")).toBe(false);
    expect(isAcceptanceCriteriaHeading("Expected Behavior")).toBe(false);
    expect(isAcceptanceCriteriaHeading("Notes")).toBe(false);
    expect(isAcceptanceCriteriaHeading("")).toBe(false);
  });
});

describe("extractSourceAcceptanceCriteria", () => {
  it("returns null when the source has no explicit AC section", () => {
    expect(extractSourceAcceptanceCriteria([paragraph("App crashes.")])).toBeNull();
    expect(extractSourceAcceptanceCriteria([heading("Steps"), list(["a", "b"])])).toBeNull();
  });

  it("extracts list items under an Acceptance Criteria heading", () => {
    const criteria = extractSourceAcceptanceCriteria([
      paragraph("App crashes."),
      heading("Acceptance Criteria"),
      list(["Does not crash", "Keeps existing data"]),
      heading("Additional Notes"),
      paragraph("Not a criterion."),
    ]);
    expect(criteria).toEqual(["Does not crash", "Keeps existing data"]);
  });

  it("extracts task-list items with checkbox state preserved", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Acceptance Criteria"),
      list(["[ ] works on Chrome", "[x] tests added"]),
    ]);
    expect(criteria).toEqual(["[ ] works on Chrome", "[x] tests added"]);
  });

  it("recognizes Requirements and Definition of Done", () => {
    expect(
      extractSourceAcceptanceCriteria([heading("Requirements"), list(["Must support Chrome 116+"])]),
    ).toEqual(["Must support Chrome 116+"]);
    expect(
      extractSourceAcceptanceCriteria([heading("Definition of Done"), list(["Merged PR"])]),
    ).toEqual(["Merged PR"]);
  });

  it("ends the section at the next same-or-higher heading", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Acceptance Criteria"),
      list(["one"]),
      heading("Notes"),
      list(["two"]),
    ]);
    expect(criteria).toEqual(["one"]);
  });

  it("keeps lower-level headings inside the section without making them criteria", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Acceptance Criteria"),
      heading("Chrome", 3),
      list(["Chrome works"]),
      heading("Edge", 3),
      list(["Edge works"]),
      heading("Notes"),
      list(["not a criterion"]),
    ]);
    expect(criteria).toEqual(["Chrome works", "Edge works"]);
  });

  it("returns null for an empty AC section", () => {
    expect(
      extractSourceAcceptanceCriteria([heading("Acceptance Criteria"), heading("Notes")]),
    ).toBeNull();
  });

  it("merges multiple AC sections in source order with exact deduplication", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Acceptance Criteria"),
      list(["one"]),
      heading("Requirements"),
      list(["two", "one"]),
    ]);
    expect(criteria).toEqual(["one", "two"]);
  });

  it("treats each paragraph in an explicit AC section as a criterion", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Requirements"),
      paragraph("The extension must not upload captured pages."),
      paragraph("The extension should support Chrome."),
    ]);
    expect(criteria).toEqual([
      "The extension must not upload captured pages.",
      "The extension should support Chrome.",
    ]);
  });

  it("never turns code, quotes, tables, images or links into criteria", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Acceptance Criteria"),
      { type: "code", code: "const x = 1;" },
      { type: "quote", text: "quoted" },
      { type: "table", rows: [["a"]] },
      { type: "image", src: "https://example.com/a.png" },
      { type: "link", href: "https://example.com/x", text: "link" },
      list(["real criterion"]),
    ]);
    expect(criteria).toEqual(["real criterion"]);
  });

  it("preserves exact source wording and case", () => {
    const criteria = extractSourceAcceptanceCriteria([
      heading("Requirements"),
      paragraph("Must NOT upload user content."),
    ]);
    expect(criteria).toEqual(["Must NOT upload user content."]);
  });

  it("never invents test/review/fix requirements", () => {
    const criteria = extractSourceAcceptanceCriteria([paragraph("App crashes.")]);
    expect(criteria).toBeNull();
    const blocks = [paragraph("App crashes.")];
    const result = extractSourceAcceptanceCriteria(blocks);
    expect(result).toBeNull();
    expect(JSON.stringify(blocks)).not.toContain("regression test");
    expect(JSON.stringify(blocks)).not.toContain("run lint");
    expect(JSON.stringify(blocks)).not.toContain("independent review");
  });

  it("does not mutate frozen input blocks", () => {
    const blocks = Object.freeze([
      Object.freeze(heading("Acceptance Criteria")),
      Object.freeze(list(["[ ] works"])),
    ]);
    expect(extractSourceAcceptanceCriteria(blocks)).toEqual(["[ ] works"]);
    expect(blocks).toHaveLength(2);
  });
});
