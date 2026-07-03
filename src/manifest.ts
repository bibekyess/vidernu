import { defineManifest } from "@crxjs/vite-plugin";

import packageJson from "../package.json";

const { version } = packageJson;

/**
 * Manifest V3 definition.
 *
 * Permissions are kept to the minimum required (FR-10.35 — privacy/minimal
 * permissions):
 * - `offscreen`   — host the WebGPU model in an offscreen document.
 * - `storage`     — mirror transient model/badge state into
 *                   `chrome.storage.session` (no user content, no persistence).
 * `host_permissions` is limited to YouTube; there is no `sidePanel` permission
 * because Vidernu renders its panel by injecting into the YouTube page itself
 * (see adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md), not via
 * the native `chrome.sidePanel` API.
 */
export default defineManifest({
  manifest_version: 3,
  name: "Vidernu",
  description: "Privacy-first, on-device grammar and translation breakdowns for YouTube captions.",
  version,
  action: {
    default_title: "Vidernu — click to open the analysis panel",
  },
  permissions: ["offscreen", "storage"],
  host_permissions: ["https://www.youtube.com/*"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://www.youtube.com/watch*"],
      js: ["src/content/content-script.ts"],
      run_at: "document_idle",
    },
  ],
});
