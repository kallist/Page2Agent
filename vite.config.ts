import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Main extension build: Side Panel (React) + Service Worker (ES module).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: {
        sidepanel: fileURLToPath(new URL("sidepanel.html", import.meta.url)),
        "service-worker": fileURLToPath(
          new URL("src/extension/background/service-worker.ts", import.meta.url),
        ),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
