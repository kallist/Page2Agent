import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// eslint-plugin-react-hooks exposes flat configs in newer versions;
// fall back to the legacy recommended rules object when unavailable.
const reactHooksRules =
  reactHooks.configs.flat?.recommended?.rules ?? reactHooks.configs.recommended.rules ?? {};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-e2e/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      ".local/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooksRules,
      // TypeScript reports unknown globals at typecheck time.
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "src/extension/background/**/*.ts",
      "src/extension/capture/**/*.ts",
      "src/extension/content/**/*.ts",
      "src/extension/messaging/**/*.ts",
      "src/extension/session/**/*.ts",
      "src/extension/sidepanel/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom"], message: "Core domain must not depend on React." },
            {
              group: [
                "../extension/**",
                "../../extension/**",
                "src/extension/**",
                "../adapters/**",
                "../../adapters/**",
                "src/adapters/**",
                "../application/**",
                "../../application/**",
                "src/application/**",
              ],
              message: "Core domain must not import extension, adapter, or application code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom"], message: "Application must not depend on React." },
            {
              group: ["../extension/**", "../../extension/**", "src/extension/**"],
              message: "Application must not import extension runtime code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom"], message: "Adapters must not depend on React." },
            {
              group: ["../extension/**", "../../extension/**", "src/extension/**"],
              message: "Adapters must not import extension runtime code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/github/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mozilla/readability"],
              message: "GitHub adapter must not depend on Readability.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["vite.config.ts", "vite.content.config.ts", "scripts/**/*.mjs", "tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
