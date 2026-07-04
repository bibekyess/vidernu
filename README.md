# Vidernu

Vidernu is a Manifest V3 Chrome extension for language learners watching foreign-language
YouTube videos with captions on. Click "Analyze current line" and Vidernu produces a
structured English breakdown of the active subtitle — translation, token-by-token grammar,
tone/formality, and the grammar rules involved — generated **entirely on-device** with a
small instruction-tuned LLM (`onnx-community/gemma-4-E2B-it-ONNX`) running locally via
WebGPU (`@huggingface/transformers` v3). No account, no API key, no server: nothing but the
one-time model download ever leaves your device.

## Prerequisites

- **Node.js 22+** (CI runs on Node 22; there's no `engines` field or `.nvmrc` pinning this
  yet, so treat it as a recommendation, not an enforced floor).
- **A Chromium-based browser with WebGPU support** (recent Chrome/Edge on desktop). Vidernu
  targets `https://www.youtube.com/watch*` pages only in v1.
- **[`just`](https://github.com/casey/just)** to run the quality gate (`just check`).
- **Network access on first run.** The first time the extension activates, it downloads the
  pinned model's weights from Hugging Face — a multi-hundred-MB+ download (INT4/`q4f16`
  quantized). Chrome caches the weights (Cache Storage) after that first download, so
  subsequent sessions load the model without re-fetching it, provided the browser hasn't
  evicted the cache.

## Local development setup

```bash
git clone <this-repo>
cd vidernu
npm install
```

There's no dev/watch script wired up yet (see `package.json`) — the workflow is
build-then-reload:

```bash
npm run build   # runs `vite build`, emits the unpacked extension into dist/
```

Load it into Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` directory produced by `npm run build`.
4. Open a YouTube watch page with captions on and click the Vidernu toolbar icon.

To iterate: change source, re-run `npm run build`, then click the reload icon on Vidernu's
card in `chrome://extensions` (or reload the extension and refresh the YouTube tab) to pick
up the new build. There is no hot-reload/watch mode currently.

## Quality gate

The single gate command, used by this repo, CI, and the reviewer alike:

```bash
just check
```

Per the `justfile`, this runs, in order:

```
format     → prettier --write .
lint       → eslint . --max-warnings 0
typecheck  → tsc --noEmit
test       → vitest run
build      → vite build
```

CI (`.github/workflows/ci.yml`) runs the exact same `just check` on every push/PR to `main`
(Node 22, `npm ci`). If `just check` is green locally, CI should be green too.

## Testing

Run just the automated unit tests:

```bash
npm test        # vitest run
```

These are unit tests over pure modules — schema validation, caption-DOM extraction (via
HTML fixtures), the message-type guards, and prompt construction. **What automated tests do
not cover:** real WebGPU inference/model output quality, live YouTube DOM behavior, the
in-page split-view layout, and Chrome toolbar badge rendering — these require a real
browser and are not (and should not be) faked with mocks. See the **Manual QA checklist**
in `plans/2026-07-03-vidernu-youtube-language-learning-extension.md` (under "Test
Strategy") for the checklist to run by hand against a loaded unpacked `dist/` build before
considering a change verified end-to-end.

## Building for release

Produce a production build:

```bash
npm run build   # -> dist/
```

To package it for local distribution or a Chrome Web Store upload, zip the contents of
`dist/` (not the `dist/` folder itself):

```bash
cd dist && zip -r ../vidernu.zip . && cd ..
```

Before actually submitting anywhere, be aware of real gaps in this repo as it stands:

- **No extension icon asset exists.** `src/manifest.ts` declares no `icons` field and there
  is no icon file anywhere in the repo (`action.default_title` is set, but there's no
  toolbar/store icon). This is a known, currently-untracked gap — add icon assets and wire
  them into the manifest before shipping anywhere users will see a listing.
- **Chrome Web Store review and privacy disclosure.** An extension that downloads and runs
  a local ML model has disclosure obligations (data/permissions justification, single
  purpose, remote code policy considerations for the downloaded model weights) that this
  repo does not attempt to pre-fill — read the current Chrome Web Store Developer Program
  Policies yourself before submitting; don't rely on this README for that.
- **Permissions review.** The manifest requests only `offscreen`, `storage`, and
  `host_permissions` for `https://www.youtube.com/*` (see `src/manifest.ts` for the
  rationale). Re-check this list stays minimal if you add functionality.

## Project structure

```
src/
  manifest.ts   # MV3 manifest (defineManifest), permissions, entry points
  background/   # thin service worker: offscreen lifecycle, badge state, message relay
  content/      # content script: caption extraction, in-page panel injection
  offscreen/    # offscreen document: owns the WebGPU model (load, inference, capability check)
  sidepanel/    # panel UI (rendered into a shadow root injected by the content script)
  shared/       # dependency-free modules shared across surfaces (constants, message types,
                # prompt building, output sanitization/schema validation)
```

## Important notes for developers

Two architectural decisions shape how the surfaces above talk to each other; read the ADRs
rather than re-deriving this from the code:

- **The offscreen document owns WebGPU inference; the service worker is a thin relay** — a
  service worker has no `navigator.gpu` and is terminated aggressively when idle, neither of
  which suits holding a multi-hundred-MB model or running long generations. See
  [`adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`](adr/2026-07-03-offscreen-document-owns-webgpu-inference.md).
- **The panel is injected into YouTube's page DOM (resizing `#columns`), not rendered via
  `chrome.sidePanel`** — `chrome.sidePanel` resizes the browser viewport, not YouTube's own
  layout, which doesn't satisfy the "video stays fully visible in a resized split view"
  requirement. There is no `sidePanel` permission or manifest key. See
  [`adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md`](adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md).

Also worth knowing: `src/shared/constants.ts` pins `DTYPE = "q4f16"` as the WebGPU-friendly
INT4 variant, but the code comment flags that this exact dtype id could not be verified
against the live Hugging Face repo in the environment it was built in — treat it as a
documented assumption to re-verify against the live model repo, not a confirmed fact.

## Further reading

This repo hands off work between stages through files, not chat context. For the full
requirements/design history behind Vidernu:

- [`specs/`](specs/) — requirements: what to build and why, with acceptance criteria.
- [`plans/`](plans/) — implementation plans: the ordered how, including the manual QA
  checklist referenced above.
- [`adr/`](adr/) — architecture decision records: the why-this-way for each significant
  decision.

See `AGENTS.md` for the conventions any contributor (human or agent) is expected to follow
in this repo.
