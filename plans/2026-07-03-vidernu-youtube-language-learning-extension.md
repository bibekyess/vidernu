# Plan — 2026-07-03 — Vidernu: privacy-first local-inference language-learning Chrome extension

Spec: `specs/2026-07-03-vidernu-youtube-language-learning-extension.md` (Ratified)
Branch: `claude/vidernu-youtube-extension-dafgh2`

## Overview

Build **Vidernu** from zero: a Manifest V3 Chrome extension that, on a YouTube watch page
with captions on, analyzes the single currently-active caption line entirely on-device
(WebGPU LLM via `@huggingface/transformers` v3) and renders a four-section
grammatical/translation breakdown in a side panel. No server, no API key, no account.

The repo today contains only org scaffolding (`AGENTS.md`, `justfile`, `specs/`,
`plans/`, `adr/`, `README.md`) — no `package.json`, no `src/`. This plan covers the entire
extension: build tooling, the three runtime surfaces (content script / thin background
service worker / offscreen document), the side panel UI, the JSON inference contract, the
quality gate, and the test strategy.

**In scope (traces to spec):** FR-1 model lifecycle + badge; FR-2 WebGPU capability
detection; FR-3 caption capture; FR-4 in-panel trigger + latest-wins; FR-5 four-section
split-view panel; FR-6 JSON inference contract; FR-7 sanitize/repair/error fallback; FR-8
English output + Korean/Japanese validation targets + best-effort note; FR-9 footprint
levers (stateless single-turn, bounded context); FR-10 local-only + minimal permissions.

**Out of scope (per spec):** UI localization, user-selectable output language, non-panel
triggers (hotkey/click-on-caption), any cloud/server fallback, analysis-history
persistence, non-watch-page surfaces (Shorts/live/embeds), batch/export/flashcards.

**Branch:** `claude/vidernu-youtube-extension-dafgh2`.

## Architecture & Design

### Corrected runtime topology (the crux — see ADR below)

WebGPU inference **cannot** run in an MV3 service worker (`navigator.gpu` is unavailable
there and the worker is ephemeral). The model therefore lives in an **offscreen document**;
the service worker is a thin relay/lifecycle owner; the content script only touches the
YouTube DOM; the side panel is the UI. Four surfaces, each with one job:

| Surface | Job | May touch |
|---|---|---|
| **Content script** (`content/`) | MutationObserver on caption DOM; capture active line on request; report caption presence + track language; degrade to "couldn't read caption" on selector failure | YouTube DOM only |
| **Service worker** (`background/`) | Lifecycle: create/close offscreen; drive badge state machine; relay messages content↔offscreen↔panel; trigger model load on install; wire `chrome.sidePanel` | `chrome.*` only, no inference |
| **Offscreen document** (`offscreen/`) | Own the transformers.js pipeline + WebGPU; download/load with progress; detect capability; run single-turn stateless inference; sanitize/repair/validate output | `navigator.gpu`, transformers.js, Cache Storage |
| **Side panel** (`sidepanel/`) | Render four sections; "Analyze current line" button; loading/error/fallback banners; show analyzed-line text | DOM of its own page + `chrome.runtime` messaging |

**Side-panel mechanism:** use the native **`chrome.sidePanel`** API. When the panel opens,
Chrome shrinks the web-content area and YouTube's responsive layout reflows — this satisfies
FR-18 ("resizes the native content wrapper, a split view, not an overlay") without injecting
into or fighting YouTube's private DOM. *(Assumption flagged for implementer: if the product
owner specifically wants the panel rendered inside the page DOM by resizing
`ytd-watch-flexy`/`#columns`, that is the fallback approach — more fragile, not recommended.
Proceed with `chrome.sidePanel` unless told otherwise.)*

### Control/data flow (one analysis)

1. User clicks **Analyze current line** in the side panel → panel sends `ANALYZE_REQUEST`
   (fresh monotonic `requestId`) to the SW.
2. SW → active tab content script (`chrome.tabs.sendMessage`) `CAPTURE_CAPTION`.
3. Content script replies `CAPTION_RESULT { present, text, lang }` (pure extractor over the
   caption DOM). If `!present` or whitespace/`[music]`-only → SW tells panel to show the
   "no analyzable line" state; stop.
4. SW ensures the offscreen document exists and the model is `ready`; forwards
   `RUN_INFERENCE { requestId, text, lang }` to offscreen.
5. Offscreen builds the prompt, runs low-temp single-turn generation, sanitizes/repairs/
   validates, and replies `INFERENCE_RESULT { requestId, result }` where `result` is either
   the FR-6 object or the FR-27 error object. A per-request timeout resolves to the FR-27
   error.
6. SW relays `ANALYSIS_RESULT { requestId, analyzedLine, result }` to the panel. Panel
   ignores any `requestId` older than the newest it issued (**latest-wins**, FR-17) and
   always displays `analyzedLine` alongside the result (FR-15).

### Model lifecycle / badge flow (FR-1)

- On `chrome.runtime.onInstalled` and on SW startup, SW ensures offscreen exists and sends
  `LOAD_MODEL`.
- Offscreen streams `MODEL_STATUS { status, progress?, message? }` (`downloading` with a
  0–100 `progress` from transformers.js `progress_callback`, then `loading`, then `ready`,
  or `error`). SW maps each to a badge via `badge.ts`.
- transformers.js persists weights in **Cache Storage** automatically
  (`env.useBrowserCache = true`); on a later session the files are served from cache and no
  re-download occurs (FR-1.1/1.2). If eviction happens, the fetch re-runs and the badge
  reflects `downloading` again (edge case).
- SW mirrors the latest status into `chrome.storage.session` so a woken SW / a freshly
  opened panel can read current state without waiting for the next push.

### Component/symbol inventory (files to create)

```
package.json                 # deps + scripts (see "just check")
vite.config.ts               # multi-surface MV3 build via @crxjs
tsconfig.json                # strict: true
eslint.config.js             # flat config, typescript-eslint
.prettierrc / .prettierignore
vitest.config.ts             # environment: 'jsdom'
.gitignore                   # node_modules, dist
src/
  manifest.ts                # MV3 manifest object consumed by @crxjs (see Interface)
  background/
    service-worker.ts        # entry: onInstalled/onStartup, message relay, sidePanel wiring
    offscreen-manager.ts     # ensureOffscreen(), hasOffscreen(), closeOffscreen()
    badge.ts                 # setBadge(status, progress?) -> chrome.action.setBadgeText/Color
  offscreen/
    offscreen.html
    offscreen.ts             # message handler; owns request lifecycle + timeout + abort flag
    model.ts                 # getPipeline() singleton, loadModel(onProgress), capability
    inference.ts             # runInference(text, lang, isSuperseded): generate -> parse
    capability.ts            # detectWebGPU(): { webgpu, adapterInfo?, lowPowerHint }
  content/
    content-script.ts        # MutationObserver lifecycle + CAPTURE_CAPTION handler + SPA re-bind
    caption-extractor.ts     # PURE: extractActiveCaption(root: ParentNode) -> CaptionCapture
  sidepanel/
    sidepanel.html
    main.ts                  # bootstrap: query state, render, button handler, message subscribe
    render.ts                # renderAnalysis(result), renderError(), renderLoading(), banners
    sidepanel.css
  shared/
    messages.ts              # discriminated-union message types + type guards (PURE)
    schema.ts                # AnalysisResult type + validateAnalysis(u): AnalysisResult|null (PURE)
    sanitize.ts              # stripFences/extractJson/repair/parse (PURE)
    prompt.ts                # buildPrompt(text, lang): chat messages (PURE)
    constants.ts             # MODEL_ID, TEMPERATURE, MAX_NEW_TOKENS, TIMEOUT_MS, badge text/colors, VALIDATED_LANGS
  test/
    fixtures/
      caption-single.html    # YouTube caption DOM snapshots (see Test Strategy)
      caption-multiline.html
      caption-music-tag.html
      caption-empty.html
    sanitize.test.ts
    schema.test.ts
    caption-extractor.test.ts
    messages.test.ts
    prompt.test.ts
```

**Testability principle (load-bearing):** all decision logic lives in the **PURE** modules
(`caption-extractor`, `sanitize`, `schema`, `messages`, `prompt`) with zero `chrome.*` or
`navigator.gpu` references, so they are unit-testable under jsdom. The chrome-dependent
files (`service-worker`, `offscreen`, `content-script`, `main`) are thin shells that wire
those pure functions to the runtime and are covered by manual QA.

### New dependencies (justified, to be pinned to exact resolved versions in `package.json` + lockfile)

Runtime (bundled, runs locally — no privacy impact, no network beyond the pinned HF weights):
- **`@huggingface/transformers` ^3** — the local WebGPU inference runtime and the only
  runtime dependency; mandated by the spec. Pin an exact 3.x version; verify the
  `onnx-community/gemma-4-E2B-it-ONNX` repo's available `dtype` variants (expect INT4, e.g.
  `q4`/`q4f16`) at pin time.

Build/dev only (never shipped to users):
- **`vite` ^6**, **`typescript` ^5**, **`@types/chrome`**, **`@types/node`**.
- **`@crxjs/vite-plugin` ^2** — wires the MV3 manifest to Vite's multi-entry build
  (service worker as module, content script, offscreen + side panel HTML pages, hashed
  assets) and produces a loadable unpacked `dist/`. It is currently a v2 beta; **fallback**
  if it proves unstable: a plain Vite multi-entry `build.rollupOptions.input` config plus a
  static `public/manifest.json` and a copy step. Pick `@crxjs` first; switch only if blocked.
- **`vitest`** (+ jsdom), **`eslint`**, **`@eslint/js`**, **`typescript-eslint`**,
  **`prettier`**.

Deliberately **not** added: no runtime JSON-repair or schema-validation library
(`jsonrepair`, `zod`) — the repair and validation logic is small, security-relevant, and
must be unit-tested, so it is hand-written in `sanitize.ts` / `schema.ts` to keep the
runtime dependency surface to exactly one package.

## Architecture Decisions (ADRs)

### ADRs to add or update

The implementer MUST create `adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`
(status `Proposed` on the branch; the reviewer flips to `Accepted` at merge) with the
content below. This records the spec's architecture correction and is a genuine
cross-cutting decision.

---
```
---
title: Offscreen document owns WebGPU model inference; service worker is a thin relay
date: 2026-07-03
status: Proposed
supersedes:
superseded-by:
---

# 2026-07-03 — Offscreen document owns WebGPU model inference; service worker is a thin relay

## Context
Vidernu must run a WebGPU-backed LLM (`@huggingface/transformers` v3,
`onnx-community/gemma-4-E2B-it-ONNX`) entirely on-device inside an MV3 extension. MV3
background logic runs in a service worker, but a service worker has no `navigator.gpu`
(no WebGPU), no full DOM, and is terminated aggressively when idle — none of which suits
loading and holding a multi-hundred-MB model and running long generations. The extension
also needs to read YouTube's caption DOM and present a side-panel UI. These concerns have
different execution-context requirements and must be separated deliberately.

## Decision
We will split the extension into four single-responsibility surfaces:
- an **offscreen document** (`chrome.offscreen`) that owns the transformers.js pipeline,
  performs WebGPU capability detection, downloads/persists weights (Cache Storage), and runs
  single-turn stateless inference;
- a **thin background service worker** that owns lifecycle (creating/closing the offscreen
  document), the toolbar badge state machine, and message relaying — and performs no
  inference;
- a **content script** that only observes/extracts YouTube's caption DOM;
- a **side panel** (`chrome.sidePanel`) that renders the four-section UI and hosts the
  "Analyze current line" trigger.
All cross-surface communication uses a single typed `chrome.runtime` message union.

## Alternatives considered
- **Run inference directly in the service worker** — rejected: no WebGPU in a service
  worker, and its aggressive termination would kill in-flight generation and force reloads
  of the model.
- **Run inference inside the content script (in the YouTube page)** — rejected: pollutes the
  page's memory with a multi-GB model, is exposed to YouTube's CSP/global mutations, and
  couples model lifetime to page navigations.
- **Run inference in the side panel page itself** — rejected: model state would die every
  time the user closes the panel; the panel should stay a lightweight, disposable UI.

## Consequences
- Clean separation: WebGPU/model lives where WebGPU and a persistent DOM exist; the service
  worker stays cheap and restart-tolerant; the panel is disposable.
- Cost: an explicit typed message-relay layer and an offscreen-lifecycle manager must be
  built and kept in sync; `chrome.offscreen.createDocument` requires a `reason`
  (`WORKERS`, justified as running WebGPU compute off the worker thread) and the
  `offscreen` permission.
- Latest-wins cancellation across surfaces is cooperative (stale results discarded by
  `requestId`) because a WebGPU generation cannot be hard-aborted mid-kernel.
```
---

**No second ADR is required.** The build-tool choice (`@crxjs/vite-plugin`) is a reversible
dev-tooling decision with a documented fallback, not a durable architectural commitment.

### Relevant ADRs for the implementer

- `adr/2026-07-02-quality-gate-contract-justfile.md` — **must read.** Fill the existing
  `format`/`lint`/`typecheck`/`test` recipe bodies (and add a `build` recipe); do **not**
  replace the `just check` contract or its recipe names. See "just check" below.
- `adr/2026-07-02-static-github-template-versioning.md` — read for context; no action.

## Implementation Steps (ordered)

Ordered by dependency: tooling → shared pure logic (with tests) → runtime shells → UI →
gate. Each step names exact files and its spec trace.

1. **Scaffold the project and build config.** Create `package.json`, `tsconfig.json`
   (`"strict": true`, `"moduleResolution": "bundler"`), `vite.config.ts` using
   `@crxjs/vite-plugin`, `eslint.config.js` (flat, `typescript-eslint`), `.prettierrc`,
   `vitest.config.ts` (`environment: 'jsdom'`), `.gitignore`. Add `src/manifest.ts`
   (see Interface & Compatibility for the exact manifest). Verify `vite build` emits a
   loadable unpacked `dist/` (SW as module, content script, `offscreen.html`,
   `sidepanel.html`). *(Trace: enables everything; NFR compatibility.)*

2. **Author `src/shared/constants.ts`.** `MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX"`,
   `DEVICE = "webgpu"`, `DTYPE` (verify variant), `TEMPERATURE = 0.1`, `MAX_NEW_TOKENS`
   (bounded, ~512, FR-9 context lever), `TIMEOUT_MS = 45_000` (FR-29, tens of seconds),
   badge strings `STBY`/`READY`/`ERR` + `DL: {n}%` formatter + badge colors,
   `VALIDATED_LANGS = ["ko","ja"]`. *(Trace: FR-1.3, FR-6.24, FR-8, FR-9, FR-29.)*

3. **Author `src/shared/messages.ts` (PURE) + tests.** Discriminated union keyed on `type`
   with the exact shapes in "Interface & Compatibility", plus a type guard per message.
   `messages.test.ts` asserts guards accept valid and reject malformed payloads.
   *(Trace: FR-1, FR-4, FR-7; enables the relay.)*

4. **Author `src/shared/schema.ts` (PURE) + tests.** `AnalysisResult` and `AnalysisError`
   types matching FR-6/FR-27 exactly; `validateAnalysis(u: unknown): AnalysisResult | null`
   (checks `translation.literal/natural` strings, `deconstruction` array of
   `{token,root,part_of_speech,role_or_meaning}`, `context` string, `grammar_rules`
   string[]; empty arrays/strings are **valid** for clean degradation). `isAnalysisError`
   guard. `schema.test.ts`: valid passes; missing/mistyped field → `null`; empty
   sections → valid. *(Trace: FR-6.23, FR-5.21.)*

5. **Author `src/shared/sanitize.ts` (PURE) + tests.** `sanitizeAndParse(raw: string):
   AnalysisResult | null` = strip ```` ```json ```` / ```` ``` ```` fences → slice from
   first `{` to last `}` → `JSON.parse`; on failure apply bounded repairs (remove trailing
   commas, collapse smart quotes) and retry; return `validateAnalysis(...)` or `null`.
   `sanitize.test.ts`: fenced JSON, JSON + trailing prose, trailing-comma, truncated/
   unrecoverable → `null`. *(Trace: FR-7.26/7.27.)*

6. **Author `src/shared/prompt.ts` (PURE) + tests.** `buildPrompt(text, lang)` returns chat
   `messages` for the tokenizer's chat template. Gemma has **no system role** — fold the
   system instruction into the first user turn: instruct return of **only** the FR-6 JSON
   object (no fences/prose), **all explanation in English**, source-language kept verbatim
   in `token`/`root`, and when `lang ∉ VALIDATED_LANGS` request best-effort. `prompt.test.ts`
   snapshots the instruction and asserts the language name and schema keys are present.
   *(Trace: FR-6.23, FR-8.30/8.31.)*

7. **Author `src/content/caption-extractor.ts` (PURE) + fixtures + tests.**
   `extractActiveCaption(root: ParentNode): { present: boolean; text: string; lang?: string }`
   reading YouTube's caption window (`.ytp-caption-window-container`, `.captions-text`,
   `.ytp-caption-segment`), joining multi-line/segment cues into one string (FR-13),
   trimming, and treating whitespace-only / bracketed sound tags (`[music]`, `[applause]`)
   as `present: false` (edge cases). Read source language from the caption track element/
   attribute when available. Save real DOM snapshots as `test/fixtures/caption-*.html`;
   `caption-extractor.test.ts` loads them via jsdom. *(Trace: FR-3.10/3.13, empty/tag edge
   cases.)*

8. **Author `src/offscreen/capability.ts` + `model.ts`.** `detectWebGPU()` →
   `{ webgpu: !!navigator.gpu, adapterInfo?, lowPowerHint }` (best-effort via
   `navigator.gpu.requestAdapter()`; `lowPowerHint` heuristic only — no fake VRAM cap,
   FR-9.33). `model.ts`: configure transformers.js (`env.allowLocalModels = false`,
   `env.useBrowserCache = true`), `getPipeline()` singleton, `loadModel(onProgress)` using
   `progress_callback` to emit 0–100. *(Trace: FR-2.7/2.9, FR-1.1/1.2/1.6, FR-9.32.)*

9. **Author `src/offscreen/inference.ts`.** `runInference(text, lang, isSuperseded): Promise<AnalysisResult|AnalysisError>`:
   tokenize `buildPrompt` via chat template; `generate` with `do_sample:true`,
   `temperature:0.1`, bounded `max_new_tokens`, **no accumulated history / fresh call each
   time** (FR-6.25, FR-9); a custom `StoppingCriteria` polling `isSuperseded()` to stop
   stale generations; pass output through `sanitizeAndParse`; on `null` return the **exact**
   FR-27 error object. *(Trace: FR-6, FR-7.27, FR-9, FR-17.)*

10. **Author `src/offscreen/offscreen.ts` + `offscreen.html`.** Message handler for
    `LOAD_MODEL` (→ `MODEL_STATUS` stream incl. `CAPABILITY`) and `RUN_INFERENCE`. Track
    `currentRequestId`; a newer request marks the prior superseded (`isSuperseded` true for
    the old id) and its result is dropped. Wrap each inference in `Promise.race` with
    `TIMEOUT_MS` → FR-27 error on timeout. *(Trace: FR-1, FR-2, FR-7.29, FR-17.)*

11. **Author `src/background/badge.ts` + `offscreen-manager.ts` + `service-worker.ts`.**
    `badge.ts`: map `MODEL_STATUS` → `chrome.action.setBadgeText/BackgroundColor` (`STBY`,
    `DL: {n}%`, `READY`, `ERR`). `offscreen-manager.ts`: `ensureOffscreen()` idempotent
    create with `reason: "WORKERS"`. `service-worker.ts`: on `onInstalled`/`onStartup`
    ensure offscreen + `LOAD_MODEL`; relay `ANALYZE_REQUEST` → `CAPTURE_CAPTION`
    (`chrome.tabs.sendMessage`) → `RUN_INFERENCE` → `ANALYSIS_RESULT`; mirror status into
    `chrome.storage.session`; call `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
    *(Trace: FR-1.3/1.4/1.5, FR-4, FR-10.35.)*

12. **Author `src/content/content-script.ts`.** Attach a `MutationObserver` to the caption
    container; on `CAPTURE_CAPTION` run `extractActiveCaption(document)` and reply
    `CAPTION_RESULT`; on extractor throw/selector-miss reply a "couldn't read caption"
    degraded result (edge case). Handle YouTube SPA navigation (`yt-navigate-finish` /
    URL change) to re-bind and disconnect stale observers (no zombie observers). *(Trace:
    FR-3, SPA-navigation & DOM-change edge cases.)*

13. **Author `src/sidepanel/{main.ts,render.ts,sidepanel.html,sidepanel.css}`.** On open,
    read state from SW (WebGPU-unavailable → fallback banner, FR-8/FR-2.8; low-power →
    non-blocking advisory, FR-2.9). "Analyze current line" button issues `ANALYZE_REQUEST`
    with a fresh monotonic id and shows a loading state (FR-20); disabled/"turn on captions"
    when no caption present (FR-3.12). `render.ts` renders the four sections (FR-5.19),
    degrading empty sections to "not available" (FR-5.21), the analyzed-line text (FR-15),
    the "not fully validated for this language" note for non-ko/ja (FR-8.31), and the FR-27
    error as a readable **retry** state (FR-7.28). Drop `ANALYSIS_RESULT` whose id is stale
    (FR-17). *(Trace: FR-2, FR-4, FR-5, FR-7, FR-8.)*

14. **Fill the quality gate in `justfile`.** Fill the existing recipe bodies and add a
    `build` recipe, keeping the `check` contract (see "just check" below). Add matching
    `package.json` scripts. *(Trace: AGENTS.md gate; ADR `quality-gate-contract-justfile`.)*

15. **Write the ADR file** `adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`
    from the content above (status `Proposed`), and add its row to the `adr/README.md`
    index table. *(Required deliverable.)*

16. **Run `just check`** and make it green (format, lint, typecheck, unit tests, build).
    Then run the **manual QA checklist** (Test Strategy) against a loaded unpacked build and
    record results in the PR. *(Trace: quality gate + acceptance criteria.)*

## Interface & Compatibility

### MV3 manifest (`src/manifest.ts`) — minimal permissions (FR-10.35)

- `manifest_version: 3`, `name`, `version`, pinned to watch pages.
- `permissions`: `["offscreen", "sidePanel", "storage"]` (`storage` for
  `chrome.storage.session` state mirror; Cache Storage for weights needs no permission).
- `host_permissions`: `["https://www.youtube.com/*"]` only.
- `content_scripts`: matches `https://www.youtube.com/watch*`, `run_at: document_idle`.
- `background: { service_worker: "src/background/service-worker.ts", type: "module" }`.
- `side_panel: { default_path: "src/sidepanel/sidepanel.html" }`.
- `action: { default_title: ... }` (badge lives on the action icon).
- **No** `webRequest`, no analytics/telemetry host, no broad `<all_urls>` (privacy).

### Message contract (the trickiest cross-cutting piece) — `src/shared/messages.ts`

Single discriminated union on `type`; `requestId: number` correlates an analysis end-to-end
and enforces latest-wins.

```
// Side panel -> SW
type AnalyzeRequest   = { type: "ANALYZE_REQUEST"; requestId: number };
type GetState         = { type: "GET_STATE" };

// SW -> content script
type CaptureCaption   = { type: "CAPTURE_CAPTION"; requestId: number };

// content script -> SW (reply)
type CaptionResult    = { type: "CAPTION_RESULT"; requestId: number;
                          present: boolean; text: string; lang?: string;
                          readError?: boolean };   // readError: DOM/selector failure

// SW -> offscreen
type LoadModel        = { type: "LOAD_MODEL" };
type RunInference     = { type: "RUN_INFERENCE"; requestId: number;
                          text: string; lang?: string };

// offscreen -> SW (pushed)
type ModelStatus      = { type: "MODEL_STATUS";
                          status: "standby" | "downloading" | "loading" | "ready" | "error";
                          progress?: number; message?: string };
type Capability       = { type: "CAPABILITY"; webgpu: boolean;
                          lowPowerHint?: boolean; adapterInfo?: string };
type InferenceResult  = { type: "INFERENCE_RESULT"; requestId: number;
                          result: AnalysisResult | AnalysisError };

// SW -> side panel (pushed)
type StateSnapshot    = { type: "STATE"; modelStatus: ModelStatus["status"];
                          progress?: number; webgpu: boolean; lowPowerHint?: boolean };
type AnalysisResultMsg= { type: "ANALYSIS_RESULT"; requestId: number;
                          analyzedLine: string; result: AnalysisResult | AnalysisError };
type NoCaption        = { type: "NO_CAPTION"; requestId: number; readError?: boolean };
```

- **AnalysisResult** (FR-6): `{ translation:{literal:string,natural:string},
  deconstruction:{token:string,root:string,part_of_speech:string,role_or_meaning:string}[],
  context:string, grammar_rules:string[] }`.
- **AnalysisError** (FR-27, exact copy): `{ error:true; message:"Local structural
  generation timed out or failed validation. Please retry parsing this line." }`.

This is a **new** extension; there are no prior published contracts to preserve. The FR-6
JSON schema and the FR-27 error string are the externally-fixed contracts and must match the
spec **verbatim**.

## Data / Migration Notes

No relational/columnar storage. Two browser-storage uses, both without schema migration:

- **Model weights** — Cache Storage, managed entirely by transformers.js
  (`env.useBrowserCache`). Persistence across sessions and eviction/re-download are handled
  by the library + FR-1 flow; do not hand-roll IndexedDB.
- **State mirror** — `chrome.storage.session` holds the transient
  `{ modelStatus, progress, webgpu, lowPowerHint }` snapshot so a woken SW / freshly opened
  panel can read current state. Session-scoped by design (no cross-session persistence, per
  the spec's "no persistence in v1").

## Test Strategy

Split honestly by what is genuinely automatable vs. what requires a loaded extension.

### Automated unit tests (Vitest + jsdom) — the PURE modules

- **`sanitize.test.ts`** — happy: bare JSON parses; fenced ```` ```json ```` extracted;
  JSON + trailing prose extracted; trailing-comma repaired. Failure: truncated/garbage →
  `null` (drives FR-27). *(FR-7.)*
- **`schema.test.ts`** — valid object passes; each missing/mistyped field → `null`; empty
  `deconstruction`/`grammar_rules` and empty strings are **valid** (FR-5.21); `isAnalysisError`
  recognizes the FR-27 object. *(FR-6, FR-5.21.)*
- **`caption-extractor.test.ts`** — over `test/fixtures/caption-*.html`: single-line
  extracted; multi-line/multi-segment cue joined into one string (FR-13); `[music]`/blank →
  `present:false`; missing container → does not throw (feeds the read-error path). *(FR-3.)*
- **`messages.test.ts`** — each type guard accepts a valid message and rejects malformed/
  wrong-`type` payloads (protects the relay contract). *(FR-1/4/7.)*
- **`prompt.test.ts`** — instruction contains all FR-6 keys, the "English only" +
  "verbatim source token/root" rules, the language name, and the best-effort branch for
  non-ko/ja. Snapshot to catch drift. *(FR-6, FR-8.)*

**Not faked:** no test asserts WebGPU output quality, real YouTube DOM behavior, badge
rendering, split-view layout, or network isolation — these need a real browser and are
covered manually below. Do not mock `navigator.gpu` / transformers.js into a pretend
"inference passes" test.

### Manual QA checklist (loaded unpacked `dist/`, mapped to acceptance criteria)

1. **Fresh install (WebGPU device):** badge STBY → `DL: n%` advancing → READY; browser and
   playback never freeze. (FR-1.)
2. **Restart:** reopen browser → READY with **no** re-download (DevTools → Cache Storage /
   Network shows no weight refetch). (FR-1.2.)
3. **Network drop mid-download:** badge → ERR/STBY; panel shows actionable message; no
   crash. (FR-1.5.)
4. **No WebGPU** (Chrome flags / disable): fallback banner, no model load attempted. (FR-2.8.)
5. **Low-power GPU:** non-blocking advisory shown; analysis still available. (FR-2.9.)
6. **Capture + trigger:** captions on → Analyze → the exact active line is captured and shown
   as the analyzed line. Captions off → button disabled / "turn on captions". (FR-3, FR-4.)
7. **Latest-wins:** rapid re-triggers → only the newest line's result renders, no
   interleaving. (FR-17.)
8. **Analyzed-line labeling:** let the video advance → panel still shows which line the
   result is for. (FR-15.)
9. **Four sections (ko + ja):** all four render; source sentence verbatim; all explanation in
   English. (FR-5, FR-8.)
10. **Untested language:** non-ko/ja line → best-effort English + "not fully validated" note,
    or FR-27 fallback. (FR-8.31.)
11. **Split view:** YouTube video stays fully visible in the resized area, not covered. (FR-18.)
12. **Empty section:** a valid response missing grammar rules → "not available", layout
    intact. (FR-5.21.)
13. **Malformed output / timeout:** exact FR-27 message renders as a readable retry state;
    retry works; layout unbroken. (FR-7.)
14. **Privacy:** DevTools Network across an analysis → only the one-time HF weight fetch; no
    subtitle text/analysis leaves the device. (FR-10.)
15. **Footprint levers:** many sequential analyses → observe no growing chat history /
    KV-cache (each call fresh). (FR-9.)

## Risk & Sequencing

**Sequencing rationale:** tooling (1) must precede everything. Shared **pure** modules
(2–7) precede the runtime shells (8–13) because the shells import them and because they
carry the automated tests — build the tested core first, then wire it. Within the runtime,
offscreen (8–10) precedes SW (11) which precedes content (12) and panel (13), matching the
message-flow direction. Gate + ADR + QA (14–16) come last.

**Risks & mitigations:**
- **YouTube caption-DOM fragility** (private, unstable selectors). → Isolate all DOM reads in
  the pure `caption-extractor` with fixtures; degrade to a clear "couldn't read caption"
  state (`readError`), never a hang. Accepted risk per spec NFR.
- **`@crxjs/vite-plugin` v2 beta instability.** → Documented fallback: plain Vite multi-entry
  + static `public/manifest.json`. Switch only if it blocks the build.
- **Model variant / OOM.** `onnx-community/gemma-4-E2B-it-ONNX` INT4 may exceed the ~1.5 GB
  soft target on some devices. → Verify the exact `dtype` variant at pin time; footprint is a
  soft target (FR-9.33), advisory warning is the only guardrail; do not implement a fake cap.
- **Offscreen `reason` semantics.** WebGPU has no dedicated reason enum. → Use `WORKERS`
  (justified in the ADR) and keep exactly one offscreen document via idempotent
  `ensureOffscreen()`.
- **Cooperative cancellation.** A WebGPU generation can't be hard-aborted mid-kernel. →
  Latest-wins is enforced by discarding stale `requestId` results + a `StoppingCriteria`
  poll; correctness does not depend on instantaneous abort.
- **Gemma chat template has no system role.** → Fold system instructions into the first user
  turn in `prompt.ts` (covered by `prompt.test.ts`).
- **SW ephemerality.** → Never hold the model in the SW; it lives in the offscreen document;
  the SW rehydrates UI state from `chrome.storage.session`.

## Assumptions flagged for the implementer

- **`chrome.sidePanel`** is the chosen split-view mechanism (browser resizes the content
  area). If the product owner requires the panel injected into YouTube's page DOM, that is
  the noted fallback — confirm before deviating.
- **Timeout = 45 s** (FR-29, "tens of seconds"); tune later.
- **No automatic silent retry** on parse failure — surface FR-27 and let the user retry, per
  the spec's accepted default. Flag if the owner wants one silent retry.
- **Pin exact versions** for every dependency in `package.json` + lockfile at implementation
  time; the ranges above are guidance, and the `gemma-4-E2B-it-ONNX` dtype must be verified
  against the live repo.

## just check (exact gate to wire in step 14)

Fill the existing `justfile` recipe bodies (do not rename recipes or change the `check`
contract — see the quality-gate ADR) and add a `build` recipe folded into `check`:

```
check: format lint typecheck test build

format:
    prettier --write .

lint:
    eslint . --max-warnings 0

typecheck:
    tsc --noEmit

test:
    vitest run

build:
    vite build
```

Mirror these as `package.json` scripts (`"lint"`, `"typecheck"`, `"test"`, `"build"`) so
they are runnable directly too. `build` is included in the gate because the spec requires a
loadable unpacked extension, so a broken bundle must fail `just check`.
