import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/** Windows often locks `node_modules/.vite/deps` so Vite's rename of deps_temp fails (EPERM) and the UI stays blank. */
function recoverWindowsViteDeps() {
  return {
    name: "recover-windows-vite-deps",
    configureServer() {
      const viteDir = path.resolve("node_modules/.vite");
      if (!fs.existsSync(viteDir)) return;
      const deps = path.join(viteDir, "deps");
      const hasReact = fs.existsSync(path.join(deps, "react.js"));
      if (hasReact) return;
      const temp = fs.readdirSync(viteDir).find((name) => name.startsWith("deps_temp"));
      if (!temp) return;
      fs.mkdirSync(deps, { recursive: true });
      fs.cpSync(path.join(viteDir, temp), deps, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), recoverWindowsViteDeps()],
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    middlewareMode: true,
  },
});
