import { resolve } from "node:path";

import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";

import manifest from "./src/manifest";

// `offscreen.html` is not one of the manifest fields @crxjs/vite-plugin scans
// for HTML entry points (background/content_scripts/action popup/side panel),
// because `chrome.offscreen` documents aren't declared in the manifest at all
// — they are created imperatively at runtime. It must be added as an explicit
// Rollup input so Vite emits a loadable `offscreen.html` into `dist/`.
export default defineConfig({
  plugins: [crx({ manifest })],
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
