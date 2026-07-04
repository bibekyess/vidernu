# Plan — Observable & robust model-load lifecycle (diagnostics)

Spec: `specs/2026-07-04-model-load-diagnostics.md`
Branch: `fix/model-load-diagnostics`

## Overview

Phase-1 observability + load-lifecycle robustness. We make the model-load lifecycle
honest and diagnosable without fixing the underlying load failure (explicitly out of
scope). Five workstreams, mapped to spec sections A–E:

- **A. Surface the real error** — `console.error` the full `Error` in the offscreen doc;
  propagate a single-line message through `MODEL_STATUS` → SW state → panel; render it in a
  dedicated panel error area with a hint and a **Retry** control.
- **B. Loading state** — fix `toLoadProgress` so the transformers.js `done` event maps to
  `loading` (not `downloading` at 100%); the offscreen doc already posts whatever
  `toLoadProgress` returns, so the fix flows through. Badge/panel present a distinct
  "preparing" meaning.
- **C. Stall timeout** — a 120s inactivity timer in the offscreen doc, reset on each
  progress update, cancelled on `ready`, that transitions to `error` with an actionable,
  retryable message. Not a hard cap.
- **D. Badge text** — non-empty text for every state (`standby`→STBY, `downloading`→NN%,
  `loading`→PREP, `ready`→READY, `error`→ERR); set on SW init before the first push.
- **E. Reliable (re-)init** — attach the offscreen listener before `LOAD_MODEL`; clean
  cold-start after full reload; reconcile restored status against offscreen actual state on
  SW-only restart; lazy re-init on first analysis as a safety net.

**In scope:** the five workstreams above and their tests. **Out of scope:** the root-cause
model-load fix (phase 2); any change to the analysis/inference path or the per-analysis
timeout; new runtime dependencies; new `ModelStatus` values.

### Assumptions surfaced from reading the code

- The offscreen doc **already** posts `MODEL_STATUS` for whatever status `toLoadProgress`
  returns (`offscreen.ts` line 46–48), so FR-6/FR-7 is a one-line map fix plus a badge/panel
  presentation fix — no new posting logic is required.
- `loadModel` **already** clears `pipelinePromise` on `catch` (`model.ts` line 81–84), so
  FR-13 (timeout leaves system retryable) is satisfied as long as the timeout path routes
  through the same rejection — see Step 3.
- The SW `catch` on the very first `LOAD_MODEL` send (`service-worker.ts` line 63–67)
  already tolerates the listener not being attached, but the *ordering* fix (FR-18) requires
  the offscreen listener to be registered synchronously at module top-level — it already is
  (`offscreen.ts` line 99), executed as soon as the offscreen doc's script runs. The real
  FR-18 gap is on the **panel** side (`main.ts` adds its listener *after* it sends
  `GET_STATE` — actually line 154 before 155, so panel is fine) and the **SW-init**
  guarantee that `ensureOffscreenDocument()` resolves before `LOAD_MODEL` (it does, line
  62–63). The concrete robustness gaps are (a) badge not set on init, and (b) no
  reconciliation / lazy re-init. See Steps 6–8 and the verification note in Step 8.

## Architecture & Design

Modules affected (layered order: types/constants → offscreen → background → panel):

1. `src/shared/constants.ts` — `BADGE_TEXT` for `loading` ("PREP"), `formatBadgeText` so
   `loading` is not treated as a percentage; add `LOAD_STALL_TIMEOUT_MS = 120_000` and a
   `LOAD_TIMEOUT_MESSAGE` string constant.
2. `src/shared/messages.ts` — add optional `message?: string` to `StateSnapshot` (mirrors
   the existing optional `MODEL_STATUS.message`); extend `isStateSnapshot` guard. No union
   change; backward-compatible per FR (NFR "Backward-compatible messaging").
3. `src/offscreen/model.ts` — `toLoadProgress` `done` → `loading`; export a small helper
   `deriveErrorMessage(err: unknown): string` (pure, unit-testable) that returns the
   single-line message or the generic fallback.
4. `src/offscreen/offscreen.ts` — `handleLoadModel`: `console.error` the raw thrown value;
   use `deriveErrorMessage` for the `MODEL_STATUS.message`; wrap the load in a stall timer
   (`armStallTimer`/`resetStallTimer`/`clearStallTimer`) that posts a timeout `error` and
   clears the load singleton. Guard against a double terminal post (timeout vs. ready/catch).
5. `src/background/service-worker.ts` — `init()` calls `setBadge(currentState.modelStatus,
   currentState.progress)` before sending `LOAD_MODEL`; store/persist/broadcast the error
   `message`; reconcile restored `ready` against offscreen actual state; lazy re-init on
   analysis when not ready.
6. `src/background/badge.ts` — no logic change (delegates to `formatBadgeText`); verify it
   now yields non-empty text for every state after the constants fix.
7. `src/sidepanel/render.ts` — add a dedicated load-error area updater
   `setLoadError(els, detail: string | null)` plus a `loadErrorRetry` button and a wiring
   hook; add the element to the skeleton and `PanelElements`.
8. `src/sidepanel/main.ts` — thread `message` from `MODEL_STATUS`/`STATE` into `applyState`;
   render the load-error area on `error`, clear it on any non-error status; wire the Retry
   button to send `LOAD_MODEL`.

No new dependency. No new `ModelStatus` value.

## Architecture Decisions (ADRs)

### ADR to add — `adr/2026-07-04-load-stall-timeout-and-error-propagation.md`

This change introduces two cross-cutting patterns worth recording: (a) a **stall/inactivity
timeout** governing the model-load lifecycle, and (b) an **error-detail propagation
contract** riding the existing message fields from offscreen → SW → panel. Both have real
alternatives (hard cap vs. stall timer; new message type vs. reusing optional fields) and
constrain future work. The implementer creates the file with this content and sets status
`Accepted` on the branch.

```
---
title: Model-load stall timeout and error-detail propagation contract
date: 2026-07-04
status: Proposed
supersedes:
superseded-by:
---

# 2026-07-04 — Model-load stall timeout and error-detail propagation contract

## Context
On capable hardware the model can fail to reach `ready` with no visible cause: the load
exception is swallowed, a stalled load never errors, and the UI misreports "downloading
100%" during the silent compile phase. Two lifecycle gaps must be closed observably,
within the existing MV3 / offscreen-document architecture (see
adr/2026-07-03-offscreen-document-owns-webgpu-inference.md), with no new runtime
dependency and no new `ModelStatus` value.

## Decision
We will:
1. Guard the model load in the offscreen document with a **stall/inactivity timer**
   (120s). The timer is armed when the load begins, reset on every progress update,
   and cleared when the model reaches `ready` or the load rejects. If it fires, the
   load transitions to `error` with an actionable timeout message and the pipeline
   singleton is cleared so a retry starts clean. It is not a hard cap on total load time.
2. Propagate the real error detail as a **single-line message on the existing optional
   `MODEL_STATUS.message` field**, mirror it onto a new optional `StateSnapshot.message`
   field, and render it in the panel. The offscreen console remains the source of truth
   for the full `Error` (message + stack) via `console.error`. No new message type is
   introduced.

## Alternatives considered
- **Hard overall load-time cap** — rejected: a legitimately slow-but-live download would
  be killed; a stall timer targets the actual failure mode (no progress) without
  penalizing slow networks.
- **New dedicated `LOAD_ERROR` / progress message type** — rejected: the existing
  `MODEL_STATUS` already carries `status` + optional `message`; adding a type widens the
  union and the guard surface for no behavioral gain.
- **Surface full stack to the panel** — rejected: the panel shows a user-appropriate
  single line + hint; full detail (with stack) belongs in the offscreen console for the
  maintainer.

## Consequences
- Easier: stalls fail fast with a retryable, diagnosable message; the panel shows the real
  reason; `loading` becomes an observable state.
- Harder / trade-offs: the offscreen doc now owns a timer whose lifecycle must be kept in
  lockstep with the terminal states (ready/error) to avoid a double terminal post or a
  dangling timer — covered by a terminal-once guard. The 120s constant is a heuristic that
  may need tuning once phase-2 root-cause data arrives.
```

### Relevant existing ADRs for the implementer

- `adr/2026-07-03-offscreen-document-owns-webgpu-inference.md` — the offscreen doc owns the
  model lifecycle and the SW is a thin relay; this plan keeps every change on the correct
  side of that boundary (timer + error derivation in offscreen; badge + relay + reconcile in
  SW; presentation in panel).
- `adr/2026-07-02-quality-gate-contract-justfile.md` — final step is `just check`.

## Implementation Steps (ordered)

### Layer 1 — shared types & constants

**Step 1 — `src/shared/constants.ts`: badge + timeout constants.** (FR-6, FR-8, FR-15,
FR-10)
- In `BADGE_TEXT`, change `loading: "DL"` → `loading: "PREP"`. Leave `standby: "STBY"`,
  `ready: "READY"`, `error: "ERR"` (already correct and non-empty).
- In `formatBadgeText`, change the percentage branch condition from
  `(status === "downloading" || status === "loading")` to `status === "downloading"` only,
  so `loading` returns `BADGE_TEXT.loading` ("PREP") not "NN%". `downloading` still returns
  "NN%". Every status now returns non-empty text (verify: `standby`→"STBY",
  `downloading` w/ progress→"NN%", `downloading` w/o progress→"DL", `loading`→"PREP",
  `ready`→"READY", `error`→"ERR").
- In `formatBadgeTitle`, split the combined `downloading`/`loading` case so `loading`
  returns a distinct "Vidernu — preparing model…" string (FR-8: not "downloading 100%").
- Add `export const LOAD_STALL_TIMEOUT_MS = 120_000;` (FR-10) with a comment noting it is a
  stall/inactivity timer, separate from `TIMEOUT_MS` (per-analysis).
- Add `export const LOAD_TIMEOUT_MESSAGE = "The model load stalled and timed out. Please retry, or reload the extension.";` (FR-10/FR-11 actionable message).
- Add `export const MODEL_LOAD_FALLBACK_MESSAGE = "The model failed to load.";` (reuse the
  existing generic string, now centralized so offscreen imports it — Assumption LOW).

**Step 2 — `src/shared/messages.ts`: optional error message on `StateSnapshot`.** (FR-3)
- Add `message?: string;` to the `StateSnapshot` interface (after `lowPowerHint`).
- Extend `isStateSnapshot` with `(value.message === undefined || isString(value.message))`.
- No change to the `Message` union or any other guard.

### Layer 2 — offscreen document

**Step 3 — `src/offscreen/model.ts`: `done` → `loading` + error-message helper.** (FR-7,
FR-2, edge cases for non-Error / empty-message)
- In `toLoadProgress`, change the `case "done":` branch from
  `return { status: "downloading", progress: aggregateProgress() };` to
  `return { status: "loading" };`. (FR-7: the terminal download event maps to `loading`.)
- Add and export a pure helper:
  `export function deriveErrorMessage(err: unknown): string { ... }` — returns
  `err.message` when `err instanceof Error && err.message.trim() !== ""`, otherwise
  `MODEL_LOAD_FALLBACK_MESSAGE` (imported from constants). Collapse newlines to a single
  line (`.replace(/\s+/g, " ").trim()`) so the panel gets a single-line message (FR-2).
- Do **not** touch `loadModel`'s singleton/`catch` logic (already correct for FR-13).

**Step 4 — `src/offscreen/offscreen.ts`: console.error, message derivation, stall timer.**
(FR-1, FR-2, FR-10–FR-14, edge cases: timeout-vs-ready race, double LOAD_MODEL)
- Import `deriveErrorMessage` from `./model`, and `LOAD_STALL_TIMEOUT_MS`,
  `LOAD_TIMEOUT_MESSAGE` from `../shared/constants`.
- Rework `handleLoadModel` to arm a stall timer around the load and to guarantee exactly one
  terminal `MODEL_STATUS` (`ready` or `error`). Concretely:
  - Add module-scoped `let loadStallTimer: ReturnType<typeof setTimeout> | null = null;`
    and `let loadTerminal = false;`.
  - Add `armStallTimer()` (sets `loadStallTimer` to fire after `LOAD_STALL_TIMEOUT_MS`,
    calling `onStallTimeout`), `resetStallTimer()` (clear + re-arm), and `clearStallTimer()`.
  - `onStallTimeout()`: if `loadTerminal` return; set `loadTerminal = true`;
    `console.error("Vidernu model load stalled (no progress within timeout)")`; `post`
    `{ type: "MODEL_STATUS", status: "error", message: LOAD_TIMEOUT_MESSAGE }`; clear the
    load singleton so a retry starts clean — call the existing reset path. Because
    `loadModel` only clears `pipelinePromise` on rejection, add a small exported
    `resetPipeline()` in `model.ts` OR reuse the existing behavior by not awaiting: prefer
    adding `export function resetPipeline(): void { pipelinePromise = null; }` in `model.ts`
    (Step 3 addendum) and call it here so the next `LOAD_MODEL` truly reloads. (FR-13.)
  - In the `progress` callback, call `resetStallTimer()` before/after posting each update
    (FR-11/FR-12: reset on every observed progress).
  - Before `await loadModel(...)`: `loadTerminal = false; armStallTimer();`.
  - On success: `if (loadTerminal) return;` (timeout already won — edge case); else
    `loadTerminal = true; clearStallTimer(); post ready` (FR-11: ready cancels the timer, no
    dangling timer).
  - In `catch (err)`: `if (loadTerminal) return;` else `loadTerminal = true;
    clearStallTimer(); console.error(err);` (log the **raw** thrown value so a non-Error is
    still visible — edge case / FR-1); then `post { status: "error", message:
    deriveErrorMessage(err) }` (FR-2).
  - Keep the existing pre-load `post downloading, progress: 0` and the WebGPU-unavailable
    early return unchanged (WebGPU path unchanged per edge case).
- The existing top-level `chrome.runtime.onMessage.addListener` stays where it is
  (registered synchronously when the offscreen script runs — FR-18 offscreen side). The
  in-flight-reuse edge case (double `LOAD_MODEL`) is already handled because `loadModel`
  reuses `pipelinePromise`; guard `handleLoadModel` re-entry by returning early if a load is
  already in flight and not yet terminal (add `let loadInFlight = false;` set true at start,
  false in the terminal branches) so a second `LOAD_MODEL` during a live load does not
  re-arm the timer or double-post `downloading, 0` (edge case: retry racing restart).

### Layer 3 — background service worker

**Step 5 — `src/background/service-worker.ts`: badge on init, error message relay,
reconcile, lazy re-init.** (FR-3, FR-15/FR-16, FR-19/FR-20/FR-21)
- Add `message?: string;` to the `ExtensionState` interface; include it in `persistState`
  (it already persists the whole object) and in the two `{ type: "STATE", ...currentState }`
  sends (spread already carries it) — verify `broadcastState` and the `GET_STATE` reply now
  carry `message` (FR-3, edge case: panel opened after error).
- In the `isModelStatusMsg` branch: set
  `currentState = { ...currentState, modelStatus: message.status, progress: message.progress, message: message.status === "error" ? message.message : undefined };`
  so the error message is stored on error and cleared on any non-error status (FR-3, FR-5
  server-side).
- In `init()`, **before** the `LOAD_MODEL` send, call
  `setBadge(currentState.modelStatus, currentState.progress);` so the badge reflects the
  restored/standby state immediately, never empty (FR-15/FR-16/FR-19: valid badge, no stale
  blank).
- **Reconcile restored status (FR-20).** After `loadPersistedState()`, if
  `currentState.modelStatus === "ready"`, do not blindly trust it: still send `LOAD_MODEL`
  (idempotent — `loadModel` returns the live singleton if the offscreen doc survived, or
  reloads if it was torn down; the offscreen doc re-posts its true status which reconciles
  `currentState`). This makes a surviving `ready` be preserved (offscreen resolves the
  singleton and re-posts `ready`) while a dead pipeline reloads. Add a short comment citing
  the FR-20 survival assumption. **Verification task for the implementer:** confirm in code
  / manual test that on a SW-only idle-restart the offscreen doc + pipeline survive
  (getContexts returns the existing doc, no re-download) — record the finding in the PR
  description. If the assumption proves false, the same `LOAD_MODEL` path still recovers by
  reloading, so behavior is safe either way.
- **Lazy re-init on analysis (FR-21).** In the `isAnalyzeRequest` branch, before/while
  ensuring the offscreen document, if `currentState.modelStatus !== "ready"` also send
  `LOAD_MODEL` (idempotent) so a stale non-ready state triggers a real (re-)load rather than
  leaving the user stranded; the panel already shows non-ready button state. Keep the
  `RUN_INFERENCE` send as-is (the offscreen side will run once loaded; if not loaded,
  `getPipeline` throws and returns an analysis error, which is the existing bounded path).

**Step 6 — `src/background/badge.ts`: verify (no logic change).** (FR-15/FR-17)
- Confirm `setBadge` already routes text through `formatBadgeText` and color through
  `BADGE_COLOR[status]`; after Step 1 it yields non-empty text for every state and keeps the
  error color for `error`. No edit expected; if a stray edit is needed, keep it minimal.

### Layer 4 — panel UI

**Step 7 — `src/sidepanel/render.ts`: dedicated load-error area + Retry control.** (FR-4,
FR-14, FR-5)
- Add `loadError: HTMLElement;` and `loadErrorRetry: HTMLButtonElement;` to
  `PanelElements`.
- In `renderSkeleton`, build a hidden load-error container (reuse `.vidernu-error` /
  `.vidernu-error-hint` classes so no CSS change is required, or add a
  `.vidernu-load-error` class in `sidepanel.css` if visual distinction from the analysis
  error is wanted — a minimal CSS addition is acceptable). Structure: a `<p>` for the detail
  message, a `<p class="vidernu-error-hint">` static hint ("Try clicking Retry, or reload
  the extension if this persists."), and a `<button type="button">Retry</button>`
  (`loadErrorRetry`). Insert it near the top (after `modelState`) so it is visible and
  distinct from the analysis-result error in `sections`. Start `hidden = true`.
- Add `export function setLoadError(els: PanelElements, detail: string | null): void` that
  shows/hides the container and sets the detail `<p>` text (empty-string detail → hidden).
  This is the "dedicated, visible error area distinct from the generic model-state banner"
  (FR-4).

**Step 8 — `src/sidepanel/main.ts`: thread message, render/clear error, wire Retry.** (FR-3,
FR-4, FR-5, FR-14)
- Import `setLoadError` from `./render`.
- Extend the `applyState` parameter type and body to accept `message?: string`. When
  `state.modelStatus === "error"`, call `setLoadError(els, state.message ?? "")`; for any
  non-error status call `setLoadError(els, null)` (FR-4 render on error, FR-5 clear on
  transition back).
- In `onMessage`: pass `message: message.message` through from the `isModelStatusMsg` and
  `isStateSnapshot` branches into `applyState` (StateSnapshot now carries `message` after
  Step 2). The `GET_STATE` reply path (line 155–160) already funnels through `applyState`,
  so a panel opened after an error renders the detail (FR-3 edge case).
- Wire the Retry control: `els.loadErrorRetry.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "LOAD_MODEL" } satisfies Message); });` (FR-14). Note:
  content-script → offscreen `LOAD_MODEL` is delivered runtime-wide; the offscreen listener
  receives it and `handleLoadModel` re-runs from a clean state (Step 4 in-flight guard
  prevents duplicate loads for double-clicks — edge case).
- Keep `describeModelState` for the one-line banner; the `loading` state now surfaces via
  `formatBadgeTitle`'s new "preparing" string (Step 1) so the banner does not read
  "downloading 100%" (FR-8).

### Final step

**Step 9 — run `just check`** (format, lint, typecheck, test, build) and fix anything it
flags. Do not use `--no-verify`.

## Interface & Compatibility

- **`StateSnapshot`** gains an optional `message?: string` — additive, backward-compatible;
  existing producers/consumers unaffected (NFR backward-compatible messaging).
- **`MODEL_STATUS.message`** semantics: now populated with the real single-line detail on
  `error` (was previously only a generic string on the caught path). Contract of the field
  is unchanged (still optional string).
- **`ModelStatus` values**: unchanged (`loading` reused, no new value — FR-6 decision).
- **Badge text**: `loading` now renders "PREP" instead of a percentage — an intentional,
  spec-required change (FR-8/FR-15).
- **`formatBadgeText`/`formatBadgeTitle`** signatures unchanged.
- No change to `RUN_INFERENCE` / `INFERENCE_RESULT` / analysis path (NFR no regressions).

## Data / Migration Notes

- `chrome.storage.session` `state` object gains an optional `message` field. No migration:
  session storage is ephemeral (cleared on full reload / browser restart per the spec's
  resolved persistence research), and a stored object without `message` is read as
  `undefined` — no schema break.

## Test Strategy

Harness facts (from existing tests): Vitest + jsdom; `vi.hoisted` + `vi.mock` to fake
`@huggingface/transformers` and the offscreen sub-modules; `vi.stubGlobal("chrome", …)` for
`chrome.*`; `vi.useFakeTimers()` is available for the stall timer. WebGPU / real
`navigator.gpu` and a real offscreen document / service worker cannot run under jsdom — so
all coverage targets the **pure mappings and the message flow through the mocked chrome
listener**, per the existing `offscreen.test.ts` / `service-worker.test.ts` patterns. Write
the failing test first for each fixed defect (AGENTS.md).

New/updated test files and the Given/When/Then criteria they cover:

- **`test/model.test.ts` (new)** — `toLoadProgress` + `deriveErrorMessage`, pure, no chrome.
  Mock `@huggingface/transformers` (`pipeline`, `env`) at the top like `offscreen.test.ts`.
  - `done` event → `{ status: "loading" }` (Section B first criterion). *Failing-first:*
    assert `loading`, which the current `downloading` mapping fails.
  - `progress`/`download`/`initiate` still map to `downloading` with an advancing
    percentage.
  - `deriveErrorMessage(new Error("boom"))` === "boom"; multi-line message collapses to one
    line; `deriveErrorMessage("weird")` / `{}` / `new Error("")` → fallback (Section A
    non-Error + empty-message edge cases).

- **`test/badge-format.test.ts` (new)** — pure `formatBadgeText`/`formatBadgeTitle` for
  every `ModelStatus` (Section D first criterion). Assert `standby`→"STBY",
  `downloading(45)`→"45%", `loading`→"PREP", `ready`→"READY", `error`→"ERR"; none empty.
  Assert `formatBadgeTitle("loading")` does not contain "downloading" and reads "preparing"
  (FR-8). *Failing-first:* `loading`→"PREP" fails today ("DL"/percentage).

- **`test/offscreen.test.ts` (extend)** — reuse the existing chrome + module mocks.
  - **Real error surfaced (Section A):** `loadModelMock.mockRejectedValue(new Error("boom"))`;
    drive `LOAD_MODEL` via `getListener()`; assert `console.error` (spy via
    `vi.spyOn(console, "error")`) received an arg whose message/stack includes "boom", and
    `sendMessage` was called with `{ type: "MODEL_STATUS", status: "error", message: "boom" }`.
  - **Non-Error throw:** `mockRejectedValue("weird")`; assert `MODEL_STATUS.message` ===
    fallback and `console.error` received the raw `"weird"`.
  - **Loading posted in a normal load (Section B):** drive the mocked `progress_callback`
    with a `progress` event then a `done` event (fake the callback by having
    `loadModelMock` invoke the passed `onProgress` — pass a mapped `LoadProgress` sequence,
    or better, keep `toLoadProgress` tested separately in `model.test.ts` and here assert the
    offscreen posts whatever `onProgress` yields, including a `loading` status strictly
    between the last `downloading` and `ready`).
  - **Stall timeout (Section C):** `vi.useFakeTimers()`; `loadModelMock` returns a pending
    promise that never resolves and emits no progress; `vi.advanceTimersByTime(120_000)`;
    assert a `MODEL_STATUS` `error` with the timeout message was posted and `resetPipeline`
    was invoked (spy on the model mock). **Timer reset:** emit a progress update at t=100s,
    advance to t=150s total → assert **no** timeout error yet (reset works). **Ready cancels
    timer:** resolve the load before 120s, advance past 120s → assert no error and no second
    terminal post (use the `loadTerminal` guard; assert only one terminal `MODEL_STATUS`).
    **Timeout-vs-ready race:** resolve ready at nearly the timeout instant → assert exactly
    one terminal status.
  - **Double LOAD_MODEL (edge case):** fire `LOAD_MODEL` twice while a load is in flight;
    assert `downloading, progress: 0` posted once and the timer armed once (in-flight guard).

- **`test/service-worker.test.ts` (extend)** — reuse the chrome mock (add
  `chrome.action.setBadgeText/setBadgeBackgroundColor/setTitle` spies).
  - **Error message relayed + persisted (Section A):** feed a `MODEL_STATUS`
    `{status:"error", message:"boom"}` through `getListener()`; assert `storage.session.set`
    was called with a `state` carrying `message:"boom"` and that a broadcast `STATE` /
    `GET_STATE` reply carries `message:"boom"`. Then feed a non-error status; assert
    `message` is cleared (FR-5 server side).
  - **Badge set on init (Section D/E):** because `init()` runs on `onInstalled`/`onStartup`,
    call it via the registered listener (the mock captures `addListener`), or export/trigger
    `init` — assert `setBadgeText` was called with non-empty text (e.g. "STBY") **before**
    the `LOAD_MODEL` `sendMessage`. Assert order using call timestamps / `mock.invocationCallOrder`.
  - **Listener-before-LOAD_MODEL (Section E):** `init()` awaits `ensureOffscreenDocument()`
    before `sendMessage(LOAD_MODEL)` — assert `getContexts`/`createDocument` resolved before
    the `LOAD_MODEL` send (invocation order). (Offscreen-side listener registration is a
    module-top side effect, exercised by `offscreen.test.ts`.)
  - **Reconcile restored ready (Section E):** stub `storage.session.get` to return
    `{state:{modelStatus:"ready", webgpu:true}}`; run `init()`; assert `LOAD_MODEL` is still
    sent (idempotent reconcile) and the badge is set to "READY" on init (not blanked).
  - **Lazy re-init on analysis (Section E):** with `currentState.modelStatus` not `ready`,
    feed an `ANALYZE_REQUEST`; assert a `LOAD_MODEL` is sent in addition to the
    `ensureOffscreenDocument` path.

- **`test/render.test.ts` (extend)** — DOM via jsdom, existing pattern.
  - **Dedicated error area (Section A):** `setLoadError(els, "boom")` → `loadError` visible,
    contains "boom" and a hint; distinct node from `sections`. `setLoadError(els, null)` →
    hidden (FR-4/FR-5).
  - **Retry control present (Section C):** skeleton contains `loadErrorRetry` button.

- **`test/messages.test.ts` (extend)** — `isStateSnapshot` accepts a snapshot with
  `message:"boom"` and one without; rejects `message: 5` (guard update from Step 2).

Panel `main.ts` message-flow/retry (clear-on-transition, Retry sends `LOAD_MODEL`) is best
covered by a focused test that mounts `mountPanel` under jsdom with a chrome mock (mirroring
`panel-injector.test.ts` if it stubs chrome) OR, if mounting proves heavy, by asserting the
`applyState`/`setLoadError` contract at the render layer (above) plus a small unit that the
Retry click handler calls `chrome.runtime.sendMessage({type:"LOAD_MODEL"})`. Choose the
lighter of the two that still exercises: error rendered on `error`, cleared on next
non-error, Retry emits `LOAD_MODEL`.

### Test-harness constraints (call out in the PR)

- No real WebGPU/offscreen/service-worker runtime under jsdom — the SW-restart offscreen
  survival (FR-20) is **not** unit-testable; verify manually and record the finding (Step 5
  verification task).
- Fake transformers.js progress: drive the `progress_callback` by having the `pipeline`
  mock capture and invoke the passed callback, or test `toLoadProgress` directly on
  `ProgressInfo` fixtures (preferred — pure).
- Fake timers: `vi.useFakeTimers()` for all stall-timer assertions; always
  `vi.useRealTimers()` in `afterEach` and `vi.resetModules()` between imports (existing
  pattern) so the module-scoped timer/terminal flags reset per test.

## Risk & Sequencing

- **Sequencing:** Steps 1–2 (types/constants) must land before 3–8 (they import the new
  constants and the `StateSnapshot.message` field). Offscreen (3–4) before background (5)
  before panel (7–8) only for reviewability; they are otherwise independent once Layer 1
  exists. Step 9 last.
- **Risk — double terminal post / dangling timer** (timeout racing ready/catch). Mitigation:
  single `loadTerminal` guard checked in all three terminal branches + `clearStallTimer` on
  every terminal; covered by the ready-cancels-timer and race tests.
- **Risk — reconcile causes a needless re-download** if the offscreen doc did *not* survive
  and `LOAD_MODEL` re-runs. Mitigation: this is the intended safe fallback (FR-20 says
  reconcile, not blindly trust); `loadModel` reuses the live singleton when present so a
  true survivor does not re-download. Flagged for manual verification.
- **Risk — Retry double-fire** (button pressed twice / retry racing restart). Mitigation:
  offscreen in-flight guard (Step 4) reuses the in-flight `loadModel` promise and does not
  re-arm the timer; covered by the double-LOAD_MODEL test.
- **Risk — `loading` badge percentage regression.** Mitigation: badge-format test asserts
  `loading`→"PREP" and `downloading`→"NN%" explicitly.
- **No new dependency; must pass `just check`** (format/lint/typecheck/test/build).
