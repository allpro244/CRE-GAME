import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // the single-file playable (package/build-onefile.mjs) inlines one module: the
  // lazily loaded WebGPU renderer (src/map/real/gpu) is folded into it there,
  // and stays a separate chunk everywhere else
  ...(mode === "onefile" ? { build: { rolldownOptions: { output: { codeSplitting: false } } } } : {}),
}));
