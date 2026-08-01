import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, "public"),
  build: {
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        options: resolve(import.meta.dirname, "options.html"),
        "service-worker": resolve(import.meta.dirname, "src/service-worker.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
})
