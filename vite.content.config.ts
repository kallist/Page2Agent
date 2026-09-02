import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Content script build: a single self-contained IIFE bundle so that
// chrome.scripting.executeScript({ files: [...] }) never depends on shared
// chunks being resolvable from the injected script.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: fileURLToPath(new URL("src/extension/content/content-script.ts", import.meta.url)),
      output: {
        format: "iife",
        entryFileNames: "assets/content-script.js",
        inlineDynamicImports: true,
      },
    },
  },
});
