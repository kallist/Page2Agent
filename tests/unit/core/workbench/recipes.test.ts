import { describe, expect, it } from "vitest";
import {
  RECIPE_IDS,
  RECIPE_TRUST_BOUNDARY_INSTRUCTIONS,
  gateRecipe,
  getRecipeDefinition,
  isRecipeId,
  isTaskKind,
  suggestRecipes,
  taskKindForRecipe,
} from "../../../../src/core/workbench/recipes";
import type { RecipeSourceProfile } from "../../../../src/core/workbench/recipes";

function profile(overrides: Partial<RecipeSourceProfile>): RecipeSourceProfile {
  return {
    sourceKind: "web",
    role: "reference",
    primary: false,
    ...overrides,
  };
}

describe("recipe definitions", () => {
  it("defines exactly the five recipes", () => {
    expect([...RECIPE_IDS]).toEqual(["learn", "compare", "verify", "build", "fix"]);
    for (const recipe of RECIPE_IDS) {
      const definition = getRecipeDefinition(recipe);
      expect(definition.id).toBe(recipe);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.summary.length).toBeGreaterThan(0);
      expect(definition.instructions.length).toBeGreaterThan(0);
      expect(definition.minSources).toBeGreaterThan(0);
    }
  });

  it("keeps generated instructions separate from source material", () => {
    expect(RECIPE_TRUST_BOUNDARY_INSTRUCTIONS.length).toBeGreaterThan(0);
    for (const instruction of RECIPE_TRUST_BOUNDARY_INSTRUCTIONS) {
      expect(instruction.length).toBeGreaterThan(0);
    }
  });

  it("requires two sources only for compare", () => {
    expect(getRecipeDefinition("compare").minSources).toBe(2);
    for (const recipe of RECIPE_IDS.filter((id) => id !== "compare")) {
      expect(getRecipeDefinition(recipe).minSources).toBe(1);
    }
  });

  it("validates recipe ids and task kinds", () => {
    expect(isRecipeId("fix")).toBe(true);
    expect(isRecipeId("chat")).toBe(false);
    expect(isTaskKind("fix_issue")).toBe(true);
    expect(isTaskKind("fix")).toBe(true);
    expect(isTaskKind("unknown")).toBe(false);
  });
});

describe("gateRecipe", () => {
  it("passes with enough sources", () => {
    expect(gateRecipe("learn", 1)).toEqual({ status: "ok", recipe: "learn", sourceCount: 1 });
    expect(gateRecipe("compare", 2)).toEqual({ status: "ok", recipe: "compare", sourceCount: 2 });
  });

  it("reports insufficient sources for compare with one source", () => {
    expect(gateRecipe("compare", 1)).toEqual({
      status: "insufficient-sources",
      recipe: "compare",
      required: 2,
      actual: 1,
    });
  });
});

describe("taskKindForRecipe", () => {
  it("maps recipes to task kinds", () => {
    expect(taskKindForRecipe("learn", false)).toBe("learn");
    expect(taskKindForRecipe("compare", false)).toBe("compare");
    expect(taskKindForRecipe("verify", false)).toBe("verify");
    expect(taskKindForRecipe("build", false)).toBe("build");
  });

  it("sharpens fix to fix_issue when an issue source is present", () => {
    expect(taskKindForRecipe("fix", true)).toBe("fix_issue");
    expect(taskKindForRecipe("fix", false)).toBe("fix");
  });
});

describe("suggestRecipes", () => {
  it("recommends fix for a task-shaped GitHub issue", () => {
    const suggestions = suggestRecipes([
      profile({ sourceKind: "github_issue", role: "task", primary: true }),
    ]);
    expect(suggestions[0]).toEqual({ recipe: "fix", reason: "github-issue-task" });
  });

  it("recommends build for technical documentation", () => {
    const suggestions = suggestRecipes([
      profile({ sourceKind: "web", adapterId: "technical-docs", role: "task", primary: true }),
    ]);
    expect(suggestions[0]).toEqual({ recipe: "build", reason: "technical-docs" });
  });

  it("recommends verify for a pull request", () => {
    const suggestions = suggestRecipes([
      profile({ sourceKind: "github_pull_request", role: "task", primary: true }),
    ]);
    expect(suggestions[0]).toEqual({ recipe: "verify", reason: "github-pr-task" });
  });

  it("offers compare once two or more sources are bundled", () => {
    const suggestions = suggestRecipes([
      profile({ sourceKind: "web", role: "task", primary: true }),
      profile({ sourceKind: "web", role: "reference" }),
    ]);
    expect(suggestions.some((entry) => entry.recipe === "compare")).toBe(true);
  });

  it("recommends learn for a single generic article", () => {
    const suggestions = suggestRecipes([
      profile({ sourceKind: "web", role: "task", primary: true }),
    ]);
    expect(suggestions[0]).toEqual({ recipe: "learn", reason: "single-web" });
  });

  it("never duplicates and stays deterministic", () => {
    const sources = [
      profile({ sourceKind: "github_issue", role: "task", primary: true }),
      profile({ sourceKind: "github_pull_request", role: "reference" }),
    ];
    const first = suggestRecipes(sources);
    const second = suggestRecipes(sources);
    expect(first.map((entry) => entry.recipe)).toEqual(
      [...new Set(first.map((entry) => entry.recipe))],
    );
    expect(first).toEqual(second);
  });

  it("returns no suggestions for an empty cart", () => {
    expect(suggestRecipes([])).toEqual([]);
  });

  it("still suggests when only reference sources exist (user stays in control)", () => {
    const suggestions = suggestRecipes([profile({ sourceKind: "web", role: "reference" })]);
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
