import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    sourcemap: false,
    emptyOutDir: false,
    outDir: resolve(import.meta.dirname, "dist/assets"),
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/content.tsx"),
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "content-script.js",
      },
    },
  },
})
