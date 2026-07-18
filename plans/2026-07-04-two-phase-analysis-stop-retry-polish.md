# Plan — 2026-07-04 — Two-phase on-demand analysis, stop & retry controls, and panel UX polish

Spec: `specs/2026-07-04-two-phase-analysis-stop-retry-polish.md` (Ratified)
Extends: `specs/2026-07-03-vidernu-youtube-language-learning-extension.md` (Delivered v1)
Branch: `claude/vidernu-youtube-extension-dafgh2`

## Overview

This is a **substantial evolution of a live, working codebase**, not a rewrite. Vidernu today
runs a **single** model generation per "Analyze current line" click that returns the whole
four-section JSON breakdown (`AnalysisResult`), rendered as four stacked sections. This change
reshapes that into:

- **(a) Two independent inference contracts** — a cheap **quick** phase (translation only) that
  runs automatically on "Analyze current line", and an on-demand **detail** phase (deconstruction
  + context + grammar) that runs only when the learner clicks "Show detailed breakdown". Each
  phase is its own prompt, its own response schema, and its own request→response round-trip
  (FR-A1/A3, FR-B1). The detail phase runs over the captured source line only — it never receives
  the Phase-1 translation as context (FR-B1a).
- **(b) A user-initiated Stop** that cancels whichever phase is in flight, implemented by
  **extending the existing supersession/`InterruptableStoppingCriteria` plumbing** with an
  explicit cancel marker (decision below), not a new parallel mechanism (FR-C).
- **(c) Per-phase Retry** that recovers a failed/timed-out/empty phase without discarding an
  already-succeeded sibling phase (FR-D). Retry scoping is a **panel-state** property because the
  offscreen document is stateless per generation — the sibling result lives only in the panel.
- **(d) A UI/visual overhaul** — four **tabs** (Translation active immediately; Deconstruction /
  Context & Meaning / Grammar Notes locked-then-populated together after Phase 2), a
  **charcoal/graphite + teal** identity with red/orange reserved for error/stop, token-card
  deconstruction rows, and a persistent **"Local · Private"** header badge (FR-E).

**In scope (traces to spec):** Group A (two-phase flow), Group B (split schema/prompt/contract),
Group C (stop), Group D (retry), Group E (tabs + identity + badge). Two new ADRs (FR-B4 + the
stop-mechanism decision).

**Out of scope (per spec):** JSON token-streaming; regenerate-a-successful-result; detail
prefetch/pre-warm; cross-session persistence; new trigger mechanisms (hotkey/click-on-caption);
revisiting the `#columns` injection architecture; model/backend/language-scope changes;
per-word popups / dual-subtitle overlays. **Do not regress** the model-load lifecycle, badge
state machine, latest-wins supersession, load-stall timeout, or model-load Retry delivered by the
two prior specs.

## Architecture & Design

### What stays exactly as-is (do not touch)

- The in-page injected panel that resizes `#columns` (`src/content/panel-injector.ts`,
  `content-script.ts`) — FR-E5, `adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md`.
- The offscreen-owns-inference relay topology — `adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`.
- The model-load lifecycle, stall timer, badge, and load-error/Retry area
  (`src/offscreen/model.ts`, `src/background/{badge,offscreen-manager,service-worker}.ts` load
  path, the `setLoadError` panel area) — `adr/2026-07-04-load-stall-timeout-and-error-propagation.md`,
  `adr/2026-07-04-local-onnx-runtime-bundling.md`. The per-phase **analysis** timeout is separate
  from the model-load **stall** timeout; keep both.
- `chrome.storage.session` state mirror, capability detection, caption capture/extractor.

### Existing correlation model (the base we extend)

Today one monotonic `requestId` (minted in `main.ts` `requestCounter`) is threaded
panel → SW → offscreen → SW → panel. The offscreen holds a single `currentRequestId`; a newer
`RUN_INFERENCE` bumps it, and the in-flight generation's polled `InterruptableStoppingCriteria`
(`inference.ts`) interrupts when `isSuperseded()` flips. The panel drops any `ANALYSIS_RESULT`
whose id ≠ its `latestRequestId`. The SW keeps `pendingAnalyses: Map<requestId,{tabId,analyzedLine}>`
so the offscreen's tab-less `INFERENCE_RESULT` can be routed back.

**Key insight that keeps this change small:** the offscreen stays **single-generation and
stateless**. Because the detail phase is gated on a *completed* quick phase (FR-A5) and retry
only re-runs an already-*failed* phase, at most one generation is ever in flight. We therefore
**keep the single `currentRequestId` supersession model** and only:
1. add a `phase` discriminator so the offscreen picks the right prompt+validator and the panel
   knows which tab area a result belongs to;
2. add an explicit **cancel marker** for user Stop (below);
3. move all *multi-phase display state* into the **panel** (it already owns per-phase rendering),
   with a small PURE state module for testability.

### Control/data flow

**Quick phase (auto, on "Analyze current line" click):**
1. Panel captures the active caption (synchronous `captureCaption()`), mints `qId = ++counter`,
   stores `currentAnalysis = { text, lang }`, sets quick→loading, sends
   `ANALYZE_REQUEST { requestId: qId, phase:"quick", text, lang }`.
2. SW records `pendingAnalyses.set(qId,{tabId,analyzedLine:text})`, ensures offscreen, lazy-loads
   model if not ready, sends `RUN_INFERENCE { requestId:qId, phase:"quick", text, lang }`.
3. Offscreen sets `currentRequestId=qId`, builds the **quick** prompt, generates, parses with the
   **quick** validator, posts `INFERENCE_RESULT { requestId:qId, phase:"quick", result }`
   (bounded by `TIMEOUT_MS`; superseded/cancelled → `superseded:true`).
4. SW relays `ANALYSIS_RESULT { requestId:qId, phase:"quick", analyzedLine, result }`; panel drops
   it unless `qId === latestQuickRequestId`, else renders the Translation tab and offers "Show
   detailed breakdown".

**Detail phase (on "Show detailed breakdown"):** identical pipeline with `phase:"detail"`, a fresh
`dId`, and **reusing `currentAnalysis.text`/`.lang`** (FR-A4 — the captured line, not the current
on-screen caption). Offscreen builds the **detail** prompt from the source line only (FR-B1a),
validates with the **detail** validator, populates the three detail tabs together (FR-E6).

**Stop:** panel sends `STOP_ANALYSIS { requestId, phase }` → SW relays `STOP_INFERENCE { requestId }`
→ offscreen marks that id cancelled so the poll interrupts (see decision). Panel transitions its
own UI **optimistically** on click and invalidates that phase's latest id.

**Retry:** panel re-runs only the failed phase (fresh id, same `currentAnalysis`), leaving the
sibling phase's stored result untouched.

### Components to create / modify

| File | Action | What |
|---|---|---|
| `src/shared/schema.ts` | modify | Add `QuickResult`, `DetailResult`, `validateQuick`, `validateDetail`; keep `AnalysisError`/`makeAnalysisError`/`isAnalysisError`. `AnalysisResult` retained only if still referenced; otherwise remove once callers migrate. |
| `src/shared/prompt.ts` | modify | Split `buildPrompt` → `buildQuickPrompt(text,lang)` (translation-only schema) and `buildDetailPrompt(text,lang)` (three-section schema, source line only). |
| `src/shared/sanitize.ts` | modify | Generalize the sanitize core to a validator-parameterized `sanitizeAndParse<T>(raw, validate)`; add `parseQuick`/`parseDetail` thin wrappers. Keep `extractGeneratedText` unchanged. |
| `src/shared/messages.ts` | modify | Add `AnalysisPhase`; add `phase` to `AnalyzeRequest`/`RunInference`/`InferenceResult`/`AnalysisResultMsg`; add `StopAnalysis` (panel→SW) and `StopInference` (SW→offscreen) + guards; widen result payload types to `QuickResult | DetailResult | AnalysisError`. |
| `src/offscreen/inference.ts` | modify | `runInference(text,lang,phase,isSuperseded)` selects prompt+parser by phase. |
| `src/offscreen/offscreen.ts` | modify | Thread `phase`; add explicit cancel marker + `handleStopInference`; per-phase result post. |
| `src/background/service-worker.ts` | modify | Relay `phase` through both directions; relay `STOP_ANALYSIS`→`STOP_INFERENCE`; drop pending entry on stop; keep lazy re-init for both phases. |
| `src/sidepanel/panel-state.ts` | **new (PURE)** | The two-phase state model + tab/controls derivation (unit-tested, no `chrome.*`/DOM). |
| `src/sidepanel/main.ts` | modify | Own `currentAnalysis`, per-phase `latest*RequestId`, wire tab clicks / detail trigger / Stop / Retry; call `panel-state` derivations; drop stale/stopped results per phase. |
| `src/sidepanel/render.ts` | modify | Tab strip + tab-panel rendering; token-card deconstruction; per-tab loading/error/retry; Stop control; header "Local · Private" badge. |
| `src/sidepanel/sidepanel.css` | modify | Charcoal/teal design tokens (CSS custom properties), tab pills, token cards, badge, stop/error red-orange. |

No new runtime or dev dependency. No manifest change.

### New dependencies

**None.** The split schema, two prompts, phase routing, and stop marker are all hand-written in
existing PURE modules — consistent with the v1 decision to keep the runtime dependency surface at
exactly `@huggingface/transformers`.

## Architecture Decisions (ADRs)

### ADR 1 to add — `adr/2026-07-04-two-phase-split-inference-contract.md`

Required by FR-B4. The implementer creates this file (status `Proposed` on the branch; reviewer
flips to `Accepted` at merge) and adds its row to `adr/README.md`. It **extends** the v1 ADRs and
the two 07-04 ADRs; it supersedes none.

```
---
title: Split the single combined inference contract into two independent phase contracts
date: 2026-07-04
status: Proposed
supersedes:
superseded-by:
---

# 2026-07-04 — Split the single combined inference contract into two independent phase contracts

## Context
Vidernu v1 answered one "Analyze current line" click with a single model generation returning a
combined four-section JSON object (v1 FR-6.23: translation + deconstruction + context +
grammar_rules). On integrated GPUs that generation is slow (bounded at TIMEOUT_MS = 120s), so a
learner who only wants to know what a line means waits for the entire deconstruction with nothing
on screen. The 2026-07-04 two-phase spec (Ratified) requires an immediate translation-only "quick"
phase and a separate, on-demand "detail" phase (deconstruction + context + grammar), each its own
request→complete-response generation, with the detail phase prompted from the captured source line
only (no Phase-1 translation as context). This is a cross-cutting change to the shared schema
(schema.ts), the message union (messages.ts), and prompt construction (prompt.ts).

## Decision
We will split the one combined contract into two independent, phase-specific request/response
shapes and prompts:
- **QuickResult** = `{ translation: { literal: string; natural: string } }`, produced by
  `buildQuickPrompt` and validated by `validateQuick`.
- **DetailResult** = `{ deconstruction: DeconstructionRow[]; context: string; grammar_rules:
  string[] }`, produced by `buildDetailPrompt` and validated by `validateDetail`.
The two shapes' union has the same content coverage as v1's four sections — nothing is dropped,
the sections are redistributed across two phases. We correlate phases on the wire with a **`phase:
"quick" | "detail"` discriminator** added to the existing `ANALYZE_REQUEST` / `RUN_INFERENCE` /
`INFERENCE_RESULT` / `ANALYSIS_RESULT` messages, rather than introducing a second parallel set of
message types — extending the existing typed union per the message-contract conventions in
messages.ts. The detail prompt is constructed from the captured source line and phase-2
instructions only; it never embeds Phase-1 output (spec FR-B1a). Each phase is bounded
independently by the existing TIMEOUT_MS (120s); a timeout in one is never attributed to the other.
Contract-version note: this is the v2 analysis contract; the v1 combined AnalysisResult contract is
retired for the analysis path.

## Alternatives considered
- **Keep one generation, split only the display into tabs** — rejected: does not deliver the
  "quick things first" responsiveness the spec's objective and FR-A1/A2 require; the learner would
  still pay for the full generation before seeing a translation.
- **Two fully separate message-type families (e.g. QUICK_REQUEST/DETAIL_REQUEST)** — rejected:
  duplicates the relay/guard surface for no behavioral gain; a `phase` discriminator on the
  existing four messages is the minimal, convention-matching extension (spec NFR
  "backward-compatible messaging where practical").
- **Feed the Phase-1 translation into the Phase-2 prompt as grounding** — rejected by the spec
  (FR-B1a, Ratified decision 3): keeps the two prompts truly independent and small and matches the
  "second, separate generation" framing; also avoids coupling detail quality to quick quality.
- **A separate, shorter timeout for the quick phase** — rejected by the spec (Ratified decision 4):
  both phases reuse the single 120s bound.

## Consequences
- Two prompts and two validators must be maintained; the sanitize/repair core is generalized to be
  validator-parameterized so both phases share it (operating on a complete response only — no
  streaming, spec FR-A6).
- The offscreen document stays single-generation and stateless: it selects prompt+validator by
  `phase` and retains no cross-phase state, preserving the v1 single-turn/no-KV-growth guarantee
  (v1 FR-6.25/FR-9) across the now-two generations per line.
- Multi-phase display state (which phase succeeded/failed, retry scoping) lives in the panel, not
  the offscreen — the sibling phase's result exists only in panel memory, so per-phase retry
  cannot disturb it.
- Extends adr/2026-07-03-offscreen-document-owns-webgpu-inference.md (same relay topology, second
  contract on top) and does not revisit the panel-injection or ORT-bundling ADRs.
```

### ADR 2 to add — `adr/2026-07-04-user-initiated-cooperative-stop.md`

The stop-mechanism decision (deliverable 6). Same lifecycle (Proposed → Accepted on merge), add
its README row. It **extends/refines** the cooperative-cancellation consequence already noted in
`adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`.

```
---
title: User-initiated Stop reuses cooperative supersession, not a hard GPU abort
date: 2026-07-04
status: Proposed
supersedes:
superseded-by:
---

# 2026-07-04 — User-initiated Stop reuses cooperative supersession, not a hard GPU abort

## Context
The two-phase spec (Group C) adds a Stop control that cancels an in-flight generation with no
replacement request. The existing architecture only halts a running generation on
*supersession* — a newer RUN_INFERENCE arriving bumps the offscreen `currentRequestId`, and the
generation's polled InterruptableStoppingCriteria (inference.ts, 200ms poll) interrupts at the
next token boundary. There is no path today for "stop the current generation and start nothing".
transformers.js v3 offers no hard, mid-kernel GPU abort; a WebGPU kernel already dispatched
completes. The spec accepts a cooperative, next-token-boundary halt (FR-C3, Ratified decision 6)
and requires that stopped output never surfaces (FR-C5) and that the panel returns to a clean state
(FR-C4).

## Decision
We will implement Stop by **extending the existing supersession plumbing with an explicit cancel
marker**, not by adding a parallel cancellation mechanism and not by attempting a hard abort:
- A new `STOP_ANALYSIS { requestId, phase }` message (panel → service worker) is relayed as
  `STOP_INFERENCE { requestId }` (service worker → offscreen).
- The offscreen document records the cancelled id (`cancelledRequestId = requestId` when it equals
  the in-flight `currentRequestId`). `isSuperseded()` — already polled by the existing
  InterruptableStoppingCriteria — is widened to also return true for the cancelled id, so the
  running generation interrupts at the next token boundary exactly like a superseded one.
- On completion the offscreen posts `INFERENCE_RESULT` with `superseded: true` for a cancelled id;
  the service worker drops it (and clears its pendingAnalyses entry) — so no result reaches the
  panel. This drop is the internal acknowledgment; no panel-facing ACK message is added.
- The panel transitions its own UI **optimistically on the Stop click** (it is authoritative over
  its own DOM) and invalidates that phase's latest requestId, so even a result that raced the stop
  is dropped panel-side. Stopping detail leaves the quick translation intact; stopping quick
  returns to a fresh "ready to analyze" state.
The documented constraint from adr/2026-07-03 remains accurate and acceptable: cancellation is
cooperative — a kernel in flight completes, no further tokens are produced, "promptly" means next
token boundary, not instantaneous.

## Alternatives considered
- **A hard GPU/kernel abort** — impossible with transformers.js v3 WebGPU; explicitly out of scope
  (FR-C3). Rejected.
- **A separate cancellation mechanism (e.g. AbortController / tearing down the pipeline)** —
  rejected: tearing down the pipeline would force a costly model reload for the next analysis and
  duplicates a mechanism the InterruptableStoppingCriteria poll already provides; a cancel marker
  reuses the proven path with a few lines.
- **A panel-facing STOP ACK message the panel waits for before transitioning** — rejected: adds a
  race (the ACK can arrive after the user has already re-triggered) for no benefit, since the panel
  already owns and can immediately reset its own display; the SW-side drop is sufficient cleanup.

## Consequences
- Stop, latest-wins supersession, and per-phase Retry all ride one small, well-tested interruption
  path.
- A brief window exists where a cancelled generation is still producing its final token(s); its
  output is discarded twice (SW drops the superseded post; panel drops by stale id), satisfying
  FR-C5 deterministically for the "stop a beat before completion" edge case.
- The offscreen gains one module-scoped `cancelledRequestId` that must be reset per new request so
  a stale cancel never suppresses a later legitimate result — covered by tests.
```

### Relevant existing ADRs for the implementer (must read)

- `adr/2026-07-03-offscreen-document-owns-webgpu-inference.md` — keep every change on the correct
  surface; the offscreen owns inference and the cancel marker, the SW only relays.
- `adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md` — the UI overhaul stays inside
  the injected shadow-root panel; do **not** move to `chrome.sidePanel` or an overlay (FR-E5).
- `adr/2026-07-04-load-stall-timeout-and-error-propagation.md` — do not regress the load path; the
  new per-phase analysis errors are distinct from load errors and render in the tabs, not the
  `setLoadError` area.
- `adr/2026-07-02-quality-gate-contract-justfile.md` — final step is `just check`; do not change
  the gate.

## Implementation Steps (ordered)

Ordered so the codebase stays buildable/testable at each step: **shared contract + its unit tests
first**, then **stop/retry message plumbing + its tests**, then the **UI/visual layer last** (least
automatable, validated by manual QA). Each step names exact files and traces to spec requirements.

### Layer 1 — split schema, prompt, sanitize (+ unit tests)

**Step 1 — `src/shared/schema.ts`: two result shapes + validators.** (FR-B1, FR-B2, FR-5.21)
- Keep `DeconstructionRow`, `AnalysisError`, `makeAnalysisError`, `isAnalysisError`.
- Add `export interface QuickResult { translation: { literal: string; natural: string } }`.
- Add `export interface DetailResult { deconstruction: DeconstructionRow[]; context: string;
  grammar_rules: string[] }`.
- Add `validateQuick(u): QuickResult | null` (translation object with two string fields) and
  `validateDetail(u): DetailResult | null` (array-of-`DeconstructionRow`, string `context`, string[]
  `grammar_rules`); empty arrays/strings remain **valid** for clean degradation (FR-5.21). Reuse the
  existing `isDeconstructionRow`/`isString` helpers.
- Remove `AnalysisResult`/`validateAnalysis` once no caller references them (they are replaced by
  the two above); if any transitional import remains during the step, keep them until Step 6.

**Step 2 — `src/shared/prompt.ts`: two prompts.** (FR-B1, FR-B1a, FR-8) Failing-first test in Step 5.
- Refactor the shared header (`describeLanguage`, `isValidatedLang`, best-effort note) into private
  helpers reused by both builders.
- `buildQuickPrompt(text, lang?)`: instruct return of ONLY `{ "translation": { "literal": string,
  "natural": string } }`, English explanations, source line kept verbatim inside the sentence,
  best-effort note for non-validated langs. Single `user` turn (Gemma has no system role).
- `buildDetailPrompt(text, lang?)`: instruct return of ONLY `{ "deconstruction": [ {token, root,
  part_of_speech, role_or_meaning} ], "context": string, "grammar_rules": string[] }`, with the v1
  deconstruction/context/grammar rules text. **Construct from the captured source line only — do
  not accept or embed any translation argument** (FR-B1a).
- Remove the combined `buildPrompt` once callers migrate (Step 3/6).

**Step 3 — `src/shared/sanitize.ts`: validator-parameterized parse.** (FR-A6, FR-B2)
- Keep `extractGeneratedText` and the private fence-strip/slice/repair/`tryParse` helpers unchanged.
- Change `sanitizeAndParse` to
  `export function sanitizeAndParse<T>(raw: string, validate: (u: unknown) => T | null): T | null`
  (same strip→slice→parse→repair→validate flow, now calling the passed validator).
- Add `export const parseQuick = (raw: string) => sanitizeAndParse(raw, validateQuick);` and
  `export const parseDetail = (raw: string) => sanitizeAndParse(raw, validateDetail);` (import the
  validators from `./schema`). Operates on a **complete** response only — no streaming (FR-A6).

**Step 4 — `src/shared/messages.ts`: phase discriminator + stop messages + guards.** (FR-B4, FR-C6, NFR)
- Add `export type AnalysisPhase = "quick" | "detail";` and import `QuickResult`/`DetailResult`.
- `AnalyzeRequest`: add `phase: AnalysisPhase`.
- `RunInference`: add `phase: AnalysisPhase`.
- `InferenceResult`: add `phase: AnalysisPhase`; widen `result` to
  `QuickResult | DetailResult | AnalysisError`.
- `AnalysisResultMsg`: add `phase: AnalysisPhase`; widen `result` likewise.
- Add `export interface StopAnalysis { type:"STOP_ANALYSIS"; requestId:number; phase:AnalysisPhase }`
  (panel→SW) and `export interface StopInference { type:"STOP_INFERENCE"; requestId:number }`
  (SW→offscreen); add both to the `Message` union.
- Add `isAnalysisPhase` helper; extend `isAnalyzeRequest`/`isRunInference`/`isInferenceResult`/
  `isAnalysisResultMsg` guards to require `phase`; add `isStopAnalysis`/`isStopInference` guards.
  (Since this is a pre-release internal contract, the phase field is required, not optional.)

**Step 5 — unit tests for Layer 1.** (FR-B1/B1a/B2, spec Testability NFR) — write these to fail
first where they assert new behavior.
- `test/schema.test.ts` (extend): `validateQuick` accepts a translation object, rejects missing/
  mistyped fields; `validateDetail` accepts full/empty sections (FR-5.21), rejects mistyped rows.
- `test/prompt.test.ts` (extend): `buildQuickPrompt` contains only the translation schema keys and
  the English/verbatim/best-effort rules; `buildDetailPrompt` contains the three heavy-section keys
  and **asserts the translation keys are absent** and that no translation string can be injected
  (function has no translation parameter) — locks FR-B1a.
- `test/sanitize.test.ts` (extend): `parseQuick` extracts a fenced/trailing-prose translation
  object; `parseDetail` extracts the three-section object; unrecoverable → `null` for each.

### Layer 2 — offscreen phase routing + stop marker (+ tests)

**Step 6 — `src/offscreen/inference.ts`: phase-select prompt + parser.** (FR-A6, FR-B1, FR-C3)
- Change signature to
  `runInference(text, lang, phase: AnalysisPhase, isSuperseded): Promise<QuickResult | DetailResult | AnalysisError>`.
- Build `messages = phase === "quick" ? buildQuickPrompt(text,lang) : buildDetailPrompt(text,lang)`;
  parse with `phase === "quick" ? parseQuick(generatedText) : parseDetail(generatedText)`.
- Keep the `InterruptableStoppingCriteria` + 200ms `isSuperseded` poll, the post-generation
  superseded check, and the `makeAnalysisError()` fallbacks exactly as-is.

**Step 7 — `src/offscreen/offscreen.ts`: thread phase, add cancel marker + stop handler.** (FR-C, FR-A8, FR-B3)
- Add module-scoped `let cancelledRequestId: number | null = null;`.
- `handleRunInference(requestId, phase, text, lang)`: set `currentRequestId = requestId`;
  `cancelledRequestId = null` for the new id (so a stale cancel never suppresses it); build
  `isSuperseded = () => currentRequestId !== requestId || timedOut || cancelledRequestId === requestId;`
  pass `phase` into `runInference`. In the terminal branch, treat
  `currentRequestId !== requestId || cancelledRequestId === requestId` as superseded → post
  `INFERENCE_RESULT { requestId, phase, result, superseded:true }`; else post
  `{ requestId, phase, result }`. Keep the `raceTimeout(..., TIMEOUT_MS, ...)` per-phase bound
  (FR-B3) unchanged.
- Add `function handleStopInference(requestId: number)`: if `requestId === currentRequestId`, set
  `cancelledRequestId = requestId` (the poll interrupts at the next token boundary). No-op
  otherwise (stale/late stop — FR edge case).
- In the `onMessage` listener add `if (isStopInference(message)) { handleStopInference(message.requestId); return; }`.
  Thread `message.phase` from `isRunInference` into `handleRunInference`.

**Step 8 — `src/background/service-worker.ts`: relay phase + stop.** (FR-A8, FR-C, FR-D, FR-21)
- `isAnalyzeRequest` branch: keep `pendingAnalyses.set(requestId,{tabId,analyzedLine:text})`; keep
  lazy re-init (`if modelStatus !== "ready" send LOAD_MODEL`); forward `phase` into `RUN_INFERENCE`.
  (Both quick and detail and all retries flow through this one branch → inherit lazy re-init and
  the double-trigger safety of unique ids.)
- Add an `isStopAnalysis(message)` branch: relay `{ type:"STOP_INFERENCE", requestId }` to the
  offscreen (`chrome.runtime.sendMessage`); it need not touch `pendingAnalyses` (the superseded
  `INFERENCE_RESULT` will clear it) but MAY `pendingAnalyses.delete(requestId)` eagerly.
- `isInferenceResult` branch: forward `phase` into `ANALYSIS_RESULT`; keep the `superseded` drop +
  `pendingAnalyses.delete` (drops both latest-wins and stopped results — FR-C5).

**Step 9 — offscreen/SW unit tests.** (FR-C, FR-A8, FR-B3)
- `test/offscreen.test.ts` (extend, reuse the existing hoisted mocks + `getListener()` + fake
  timers): quick vs detail route to the right prompt/parser (assert via the `runInferenceMock`
  argument / `buildQuickPrompt` vs `buildDetailPrompt` — mock those if needed); a `STOP_INFERENCE`
  for the in-flight id flips `isSuperseded` so the result posts with `superseded:true`; a
  `STOP_INFERENCE` for a non-current id is a no-op; a stale `cancelledRequestId` does not suppress a
  later new request's result; per-phase 120s timeout still resolves to the error object.
- `test/service-worker.test.ts` (extend): `ANALYZE_REQUEST` with `phase:"detail"` relays
  `RUN_INFERENCE` with that phase and sets a pending entry; `STOP_ANALYSIS` relays `STOP_INFERENCE`
  with the same id; a superseded `INFERENCE_RESULT` is dropped and the pending entry cleared;
  `ANALYSIS_RESULT` carries `phase`.
- `test/messages.test.ts` (extend): guards require `phase`; `isStopAnalysis`/`isStopInference`
  accept valid and reject malformed payloads.

### Layer 3 — panel state model (PURE) + tests

**Step 10 — `src/sidepanel/panel-state.ts` (new, PURE).** (FR-A, FR-C4, FR-D, FR-E4, FR-E6, Testability NFR)
Define the two-phase view model and pure derivations (no `chrome.*`, no DOM):
- `type PhaseStatus = "idle" | "loading" | "done" | "error";`
- `type TabId = "translation" | "deconstruction" | "context" | "grammar";`
- `interface PanelState { line: string | null; lang?: string;
    quick: { status: PhaseStatus; result?: QuickResult; error?: string };
    detail: { status: PhaseStatus; result?: DetailResult; error?: string };
    activeTab: TabId; }`
- Pure transition helpers returning a new state (used by `main.ts` reducers): `startQuick(line,lang)`
  (resets everything, quick→loading, activeTab=translation, detail→idle — this is FR-A8 whole-panel
  replacement and the accepted assumption that a fresh analyze clears prior tabs); `quickSucceeded`,
  `quickFailed(msg)`, `startDetail`, `detailSucceeded`, `detailFailed(msg)`, `stopQuick` (→ fresh
  idle "ready" per FR-C4), `stopDetail` (→ detail back to idle, quick result intact per FR-C4),
  `retryQuick`, `retryDetail`, `setActiveTab`.
- Pure selectors (the spec's named "active/pending tab derivation" and "phase/state derivation"):
  - `type TabVisual = "active" | "available" | "pending" | "loading" | "error";`
  - `deriveTabStates(s): Record<TabId, TabVisual>` — translation reflects quick; the three detail
    tabs are `pending` until detail done, `loading` while detail loading, `error` on detail error,
    `available` when done; the `activeTab` overrides to `active`. (FR-E6 locked/pending semantics.)
  - `showDetailTrigger(s) = s.quick.status === "done" && s.detail.status === "idle"` (FR-A5).
  - `runningPhase(s): AnalysisPhase | null` — the phase whose status is `loading`; drives the Stop
    control visibility/target (FR-C1/C2).
  - `retryPhase(s): AnalysisPhase | null` for whichever phase is in `error` (FR-D3).

**Step 11 — `test/panel-state.test.ts` (new, PURE).** (FR-A/C/D/E4/E6, Testability NFR) — failing-first.
Cover the full state machine and derivations: idle → quick-loading → quick-done(detail locked) →
detail-loading → detail-done; quick-error offers retry and no detail trigger (FR-A5); detail-error
keeps quick result and shows detail-only retry (FR-D2); `stopDetail` preserves quick, `stopQuick`
resets to ready (FR-C4); `startQuick` wipes prior detail (FR-A8); `deriveTabStates` marks detail
tabs pending until done and never `active`-without-content; `runningPhase`/`retryPhase`/`showDetailTrigger`
across every state. Double-retry is a no-op transition when the phase is already `loading`.

### Layer 4 — UI/visual (render, main, css) — manual-QA validated

**Step 12 — `src/sidepanel/sidepanel.css`: charcoal/teal design tokens.** (FR-E7, FR-E8, NFR accessibility)
- Define CSS custom properties on `:host, .vidernu-panel` so the implementer is not inventing values
  ad hoc, e.g. `--vd-bg:#1e2124; --vd-surface:#26292e; --vd-surface-2:#2f333a; --vd-text:#e8eaed;
  --vd-text-muted:#9aa0a6; --vd-accent:#1fb8a6; --vd-accent-ink:#04211d; --vd-danger:#e5734d;
  --vd-danger-bg:#3a2320; --vd-border:#3a3f46; --vd-radius:10px;` (exact hex is the implementer's
  lane per the LOW assumption, but MUST be charcoal/graphite background, teal single primary accent,
  red/orange only for error/stop; ensure WCAG contrast for text on charcoal and teal-ink on teal).
- Style: tab strip (flex row of pills); active tab = filled teal pill with `--vd-accent-ink` text;
  inactive available tab = muted dark pill; pending/locked tab = dimmed with a lock affordance and
  `aria-disabled` styling, visually distinct from both; per-tab small uppercase accent-colored
  heading label (FR-E6); token-card grid for deconstruction (reading, bordered/tinted native-script
  token box using `--vd-accent` border, English explanation); primary buttons ("Analyze current
  line", "Show detailed breakdown") teal; **Stop button and inline error/retry** use `--vd-danger`
  (never teal); the existing `.vidernu-load-error`/`.vidernu-retry-btn` recolor to the token
  palette. Add `.vidernu-badge-local` (small, neutral/teal-tinted, never red — FR-E8). Add gentle
  transitions (opacity/transform) on tab-panel swap for no-jank (FR-E4); avoid layout reflow by
  keeping tab-panel container height stable.

**Step 13 — `src/sidepanel/render.ts`: tabs, token-cards, per-tab loading/error, stop, badge.** (FR-E)
- Header: keep the title + "Analyze current line" button; add a persistent
  `<span class="vidernu-badge-local">Local · Private</span>` (FR-E8), present in every state, not
  styled as error.
- Replace the four stacked `renderSection` calls with a **tab strip** (`role="tablist"`, four
  `role="tab"` buttons with `aria-selected`/`aria-disabled` and text labels — color is not the sole
  signal, NFR accessibility) plus a single tab-panel container (`role="tabpanel"` with an
  `aria-live="polite"` region so phase completion/failure is announced).
- Add render functions driven by `panel-state` output: `renderTabs(els, tabStates, activeTab)`;
  `renderTranslationTab(els, quick)` (loading spinner confined to this tab / result / inline
  error+Retry); `renderDetailTabs(els, detail)` (locked/pending placeholder / loading confined to
  the tab / result / inline error+Retry spanning the three detail tabs); a
  `renderDeconstructionTokenCards(rows)` producing per-token cards (replaces the old
  `<table>` — remove `renderDeconstructionSection`'s table); `renderContextTab`, `renderGrammarTab`.
- `setDetailTrigger(els, visible)` — the "Show detailed breakdown" button, shown only when
  `showDetailTrigger` is true (FR-A3/A5).
- `setStopControl(els, phase | null)` — a Stop button visible only while a phase is running
  (FR-C1/E2), labeled+iconed, red-orange; hidden when `runningPhase` is null.
- Keep `setLoadError`/`loadErrorRetry` (model-load path) as-is — the per-phase analysis errors are a
  **separate** inline-in-tab affordance and must not reuse the load-error area (do not regress the
  07-04 load diagnostics behavior). Keep the fallback/advisory/validation banners and analyzed-line
  label; the analyzed-line label persists across both phases (FR-A4).
- `PanelElements` gains: `localBadge`, `tabStrip`, the four tab buttons, `tabPanel`, `detailTrigger`,
  `stopButton` (plus per-phase retry buttons created within the tab content or referenced for
  wiring).

**Step 14 — `src/sidepanel/main.ts`: own two-phase state, wire controls.** (FR-A, FR-C, FR-D, FR-E)
- Replace the single `latestRequestId` with `latestQuickRequestId`/`latestDetailRequestId` and add
  `let state: PanelState` (from `panel-state.ts`) plus `let currentAnalysis: { text:string; lang?:string } | null`.
- Add a `render()` that calls the `panel-state` selectors and the Step-13 render functions
  (single source of truth: mutate `state` via the pure helpers, then `render()`).
- **Analyze click:** capture; on `readError`/`!present` show the existing messages; else set
  `currentAnalysis`, `state = startQuick(text,lang)`, `qId=++counter`, `latestQuickRequestId=qId`,
  reset `latestDetailRequestId=0` (drops any late prior-detail result — FR-A8), send
  `ANALYZE_REQUEST { phase:"quick", requestId:qId, text, lang }`, `render()`.
- **Show detailed breakdown click:** guard on `showDetailTrigger`; `dId=++counter`,
  `latestDetailRequestId=dId`, `state=startDetail(state)`, send `ANALYZE_REQUEST { phase:"detail",
  requestId:dId, text:currentAnalysis.text, lang:currentAnalysis.lang }` (**same captured line** —
  FR-A4), `render()`.
- **Stop click:** determine `runningPhase(state)`; send `STOP_ANALYSIS { requestId: (that phase's
  latest id), phase }`; optimistically `state = phase==="quick" ? stopQuick(state) : stopDetail(state)`;
  invalidate that phase's latest id (set it to `++counter` sentinel never sent) so a raced result is
  dropped; `render()` (FR-C4/C5).
- **Retry click (per phase):** guard against double-fire (ignore if that phase already `loading`);
  `state = phase==="quick" ? retryQuick(state) : retryDetail(state)`; mint a fresh id for that phase,
  update the phase's latest id, resend `ANALYZE_REQUEST` with that phase and `currentAnalysis`
  (FR-D2/D4/D5). Do not touch the sibling phase's id/result.
- **Tab click:** `state = setActiveTab(state, id)` for available tabs; ignore locked/pending tabs;
  `render()`.
- **`ANALYSIS_RESULT` handler:** branch on `message.phase`; drop unless the id matches that phase's
  latest id (per-phase latest-wins + stop invalidation — FR-A8/C5); on quick error →
  `quickFailed`; quick success → `quickSucceeded` + validation note (reuse existing logic, keyed on
  `currentAnalysis.lang`); detail error → `detailFailed`; detail success → `detailSucceeded`;
  `render()`.
- Keep the model-status/capability/`GET_STATE` handling and `setLoadError` wiring unchanged
  (analyze button still gated on `modelStatus === "ready"` and WebGPU).

**Step 15 — extend `test/main.test.ts` and `test/render.test.ts`.** (FR-A/C/D/E6)
- `main.test.ts` (extend, reuse the chrome mock + `fire()`): a quick `ANALYSIS_RESULT` renders the
  Translation tab and reveals the detail trigger; a detail result with a stale id is dropped; a
  fresh Analyze while detail is pending drops a late detail result (FR-A8); a Stop click sends
  `STOP_ANALYSIS` and transitions optimistically (quick intact when stopping detail); a Retry
  resends only its phase.
- `render.test.ts` (extend): tab strip renders four tabs with correct `aria-selected`/`aria-disabled`
  from `deriveTabStates`; deconstruction renders **token-cards** not a `<table>`; the "Local ·
  Private" badge is present in the skeleton; Stop control shows only when a running phase is passed.

### Final step

**Step 16 — run `just check`** (format, lint, typecheck, test, build) and make it green; do not use
`--no-verify`. Then run the updated **manual QA checklist** (Test Strategy) against a loaded
unpacked build and record results in the PR.

## Interface & Compatibility

### Updated message contract (`src/shared/messages.ts`)

`requestId` stays a monotonic number minted per generation in `main.ts`; `phase` correlates a
result to its tab area; per-phase latest-id tracking lives in the panel.

```ts
export type AnalysisPhase = "quick" | "detail";

export interface QuickResult  { translation: { literal: string; natural: string } }         // schema.ts
export interface DetailResult { deconstruction: DeconstructionRow[]; context: string; grammar_rules: string[] } // schema.ts

// panel -> SW
interface AnalyzeRequest { type:"ANALYZE_REQUEST"; requestId:number; phase:AnalysisPhase; text:string; lang?:string }
interface StopAnalysis   { type:"STOP_ANALYSIS";   requestId:number; phase:AnalysisPhase }
interface GetState       { type:"GET_STATE" }

// SW -> offscreen
interface RunInference   { type:"RUN_INFERENCE";  requestId:number; phase:AnalysisPhase; text:string; lang?:string }
interface StopInference  { type:"STOP_INFERENCE"; requestId:number }
interface LoadModel      { type:"LOAD_MODEL" }

// offscreen -> SW (pushed)
interface InferenceResult{ type:"INFERENCE_RESULT"; requestId:number; phase:AnalysisPhase;
                           result: QuickResult | DetailResult | AnalysisError; superseded?:boolean }
// ModelStatusMsg / CapabilityMsg unchanged.

// SW -> panel
interface AnalysisResultMsg { type:"ANALYSIS_RESULT"; requestId:number; phase:AnalysisPhase;
                              analyzedLine:string; result: QuickResult | DetailResult | AnalysisError }
// StateSnapshot / TogglePanel unchanged.
```

- **Stop acknowledgment:** the offscreen posts `INFERENCE_RESULT { superseded:true }` for a
  cancelled id; the SW drops it and clears its `pendingAnalyses` entry. That drop is the ack; the
  panel does not wait for it (it transitions optimistically). No panel-facing STOP-ACK message is
  added (ADR 2 rationale).
- **AnalysisError** unchanged (`{ error:true; message:string }`, `makeAnalysisError()` shared by both
  phases). The v1 combined `AnalysisResult` contract is retired for the analysis path (v2 contract).
- These are internal cross-surface contracts (no external consumer); the `phase` field is required.

## Data / Migration Notes

No storage-schema change. `chrome.storage.session` still mirrors only `{ modelStatus, progress,
webgpu, lowPowerHint, message }` — model-load state, untouched by this change. No analysis result
(quick or detail) is persisted (unchanged from v1). No IndexedDB/Cache-Storage change (model
weights untouched).

## Test Strategy

Consistent with the repo's split: **pure/decision logic gets real unit tests (Vitest + jsdom, no
`chrome.*`)**; WebGPU inference quality and live YouTube/Chrome behavior remain **manual-QA only**.
Do not mock transformers.js into a pretend "inference passes" test.

### Newly and meaningfully unit-testable (add failing-first where behavior changes)

- **Split contract:** `validateQuick`/`validateDetail` (schema.test), `buildQuickPrompt`/
  `buildDetailPrompt` incl. the FR-B1a assertion that the detail prompt cannot embed translation
  (prompt.test), `parseQuick`/`parseDetail` (sanitize.test).
- **Message routing/guards:** required `phase`, `isStopAnalysis`/`isStopInference` (messages.test).
- **Offscreen phase-routing + stop-marker + per-phase supersession/timeout** (offscreen.test) and
  **SW phase/stop relay + superseded drop** (service-worker.test) — via the existing mocked-chrome
  `getListener()` harness and fake timers.
- **Panel two-phase state machine + tab/controls derivation** — the highest-value new pure surface
  (`panel-state.test`): retry-scoping (sibling untouched), stop transitions (quick intact / reset),
  latest-wins wipe, `deriveTabStates`/`runningPhase`/`retryPhase`/`showDetailTrigger`.
- **Panel message-flow + DOM shell** (main.test / render.test): per-phase stale-drop, optimistic
  stop transition, token-card rendering, tab aria states, persistent badge, Stop visibility.

### Not unit-testable (manual QA only)

Real WebGPU generation and its quality/latency; the cooperative next-token-boundary halt actually
stopping GPU work (offscreen has no real pipeline under jsdom); real YouTube `#columns` split-view;
visual palette/contrast/jank; keyboard/AT behavior of tabs.

### Manual QA checklist changes vs. the v1 plan

Update the v1 plan's checklist (items 6–13 assumed a single combined result). New/changed items:
1. Analyze → **only** the translation renders on an active Translation tab; the three detail tabs
   are visibly present but locked/pending; "Show detailed breakdown" offered; no
   deconstruction/context/grammar generated yet (FR-A1/A2/E6).
2. Do nothing → detail phase never runs (no background prefetch) (FR-A3).
3. Show detailed breakdown → second generation populates the three detail tabs together; translation
   stays; loading confined to the detail tabs (FR-A3/E1).
4. Advance the video, then Show detailed breakdown → detail analyzes the **originally captured**
   line; label unchanged (FR-A4).
5. Fresh Analyze while detail in flight → panel shows only the new line's quick flow; no
   stale/interleaved output (FR-A8).
6. Stop the detail phase → halts promptly; translation stays; detail requestable again (FR-C4).
7. Stop the quick phase → returns to fresh "ready to analyze"; no partial result/indicator (FR-C4).
8. Stop a beat before completion → deterministic: either result renders or stop wins, never both,
   no late leak (FR-C5, edge case).
9. Quick succeeds, detail fails/times out → detail tabs show inline error + Retry (phase-2 only);
   translation untouched; retry re-runs detail only (FR-D2/D3).
10. Quick fails → inline error + Retry on Translation tab; no detail trigger; detail tabs stay
    locked (FR-A5/D2).
11. Double-press Retry → no duplicate concurrent generation (edge case).
12. Visual identity: charcoal/graphite bg, teal active tab/primary buttons, red/orange only for
    error/Stop; deconstruction as token-cards; "Local · Private" badge in header across all states
    (FR-E6/E7/E8).
13. Video stays fully visible in the resized `#columns` split view (FR-E5).
Retain the v1 model-lifecycle/badge/WebGPU/privacy/footprint items unchanged.

## Risk & Sequencing

**Sequencing rationale:** Layer 1 (shared contract + tests) is imported by everything and carries
the split's automated safety net, so it lands first. Layer 2 (offscreen/SW plumbing + tests) depends
on the new message types. Layer 3 (the pure panel-state module + tests) can be authored right after
Layer 1 but is placed before Layer 4 because the UI consumes its selectors. Layer 4 (render/main/css)
is last: it is the least automatable and best validated by manual QA. Each layer keeps `just check`
green.

**Risks & mitigations:**
- **Two concurrent generations on one pipeline** (a stopped/superseded generation still looping when
  a new one starts). This is the *existing* cooperative-cancellation constraint, not new — at most
  one generation is *intended* at a time (detail gated on completed quick; retry only after
  failure). Mitigation: unchanged `InterruptableStoppingCriteria` poll + the cancel marker; the old
  loop interrupts at its next token boundary and its result is discarded by id. Accepted per FR-C3.
- **Stale cancel suppressing a later legitimate result.** Mitigation: reset `cancelledRequestId =
  null` at the start of each `handleRunInference`; covered by an offscreen test.
- **Per-phase latest-id bookkeeping drift** (a late result rendering into the wrong tab or after
  stop). Mitigation: strictly branch on `phase` and compare against that phase's latest id; stop
  bumps the id to a never-sent sentinel; covered by main.test + panel-state.test.
- **FR-B1a regression risk** (someone later feeds the translation into the detail prompt).
  Mitigation: `buildDetailPrompt` takes no translation parameter and a prompt.test asserts the
  translation keys are absent — makes the violation a compile/test failure.
- **Regressing the model-load Retry/stall path** by conflating it with per-phase analysis Retry.
  Mitigation: keep `setLoadError`/`loadErrorRetry` and the load lifecycle untouched; per-phase
  errors render inline in tabs via separate elements.
- **Tab jank / layout reflow** (FR-E4). Mitigation: single stable tab-panel container, opacity/transform
  transitions, no full-panel spinner; validated manually.
- **Accessibility of the new controls.** Mitigation: `role=tablist/tab/tabpanel`, `aria-selected`/
  `aria-disabled`, `aria-live="polite"` for phase completion, text+icon (not color-only) on
  Stop/error; asserted structurally in render.test and checked in manual QA.

## Assumptions flagged for the implementer

- **Offscreen stays single-generation.** Justified because detail is gated on a completed quick and
  retry only follows a failure, so overlapping generations are not an intended state. If a future
  change wants true concurrency, the single `currentRequestId`/cancel-marker model would need
  revisiting — out of scope here.
- **Panel is authoritative for Stop UX** (optimistic transition, no panel-facing ACK) — see ADR 2.
- **Exact teal/charcoal hex, spacing, motion, iconography, and copy** are the implementer's lane
  (spec LOW assumptions); the CSS-custom-property names above are a suggested scaffold, not a pixel
  spec — but the palette *rules* (charcoal bg, single teal accent, red/orange only for error/stop)
  are settled and must hold.
- **Fresh Analyze wipes prior tabs** (whole-panel replacement) and **stopping quick clears the
  analyzed-line label** — both are the spec's accepted LOW assumptions; `startQuick`/`stopQuick`
  encode them.
- **`just check` needs no new tooling** — the split, phase routing, stop, and pure state module are
  all covered by the existing Vitest/jsdom + ESLint + tsc + Vite build gate. Confirm the new
  `panel-state.test.ts` and extended tests run under `vitest run`.
