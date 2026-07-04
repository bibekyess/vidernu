import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { crx } from "@crxjs/vite-plugin";
import { defineConfig, type Plugin } from "vite";

import manifest from "./src/manifest";

// MV3 forbids loading remote scripts (script-src 'self' only). ORT's default
// behaviour is to load its .mjs glue from cdn.jsdelivr.net at runtime, which
// Chrome blocks. We copy both asyncify ORT files into dist/ort/ at build time
// so the offscreen document can point wasmPaths at the extension origin instead.
// The version is taken from the onnxruntime-web package that transformers.js
// resolves, so the bundled files always match the version used at runtime.
//
// import.meta.resolve() walks up from the worktree through parent node_modules
// directories, finding the actual package regardless of whether the worktree has
// its own node_modules — so the resolved version always matches what Node/Vite
// uses at build time.
function copyOrtRuntime(): Plugin {
  // Resolve from the onnxruntime-web package entry to its dist/ directory.
  const ortPkg = fileURLToPath(import.meta.resolve("onnxruntime-web"));
  const ORT_DIST = dirname(ortPkg);

  const FILES = [
    "ort-wasm-simd-threaded.asyncify.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
  ] as const;

  return {
    name: "copy-ort-runtime",
    generateBundle() {
      for (const file of FILES) {
        this.emitFile({
          type: "asset",
          // Stable path in dist/ort/ — no content-hash suffix so the
          // offscreen document can reference it via chrome.runtime.getURL().
          fileName: `ort/${file}`,
          source: readFileSync(join(ORT_DIST, file)),
        });
      }
    },
  };
}

// `offscreen.html` is not one of the manifest fields @crxjs/vite-plugin scans
// for HTML entry points (background/content_scripts/action popup/side panel),
// because `chrome.offscreen` documents aren't declared in the manifest at all
// — they are created imperatively at runtime. It must be added as an explicit
// Rollup input so Vite emits a loadable `offscreen.html` into `dist/`.
export default defineConfig({
  plugins: [crx({ manifest }), copyOrtRuntime()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
      },
    },
  },
});
