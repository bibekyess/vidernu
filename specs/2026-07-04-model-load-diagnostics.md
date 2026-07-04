---
title: Observable & robust model-load lifecycle (diagnostics)
date: 2026-07-04
status: Delivered       # Draft | Ratified | Delivered
---

# 2026-07-04 — Observable & robust model-load lifecycle (diagnostics)

## Objective
On capable hardware (Intel Arc, WebGPU "Available", `shader-f16` supported,
`requestDevice()` succeeds) the extension still cannot reach `modelStatus === "ready"`,
and the user has no way to find out why: the load exception is swallowed, the UI sits at
"downloading 100%" through the silent compile phase, a stalled load never errors, and
after an extension reload the panel shows a stale/blank status with an empty toolbar badge
and no reliable re-initialization. This change makes the model-load lifecycle **observable
and honest** so the true root cause becomes visible and the UI never misrepresents state.
It is explicitly **phase 1**: it does not attempt to fix the underlying load failure (which
is unknown until errors are surfaced) — it makes that failure fully visible and makes the
lifecycle robust to restart and reload.

## User stories
- As a user on capable hardware whose model fails to load, I want to see the real error
  message in the panel (and the full error in the offscreen console) so that I — or a
  maintainer — can diagnose why, instead of a generic "model error" line.
- As a user watching the model load, I want a distinct "preparing/loading" state after the
  download reaches 100% so that the UI does not falsely claim "downloading 100%" while the
  model is actually compiling.
- As a user whose load silently stalls, I want it to fail with an actionable message within
  a bounded time so that I am not stranded staring at "100%" indefinitely.
- As a user whose load errored, I want a "Retry" control in the panel so that I can recover
  without reloading the whole extension.
- As a user who reloads the extension or whose service worker restarts, I want the toolbar
  badge and panel to reflect the true current state and the model to re-initialize
  reliably, so that I am never stranded at a stale status or an empty badge.
- As a maintainer, I want the failure surfaced with enough detail (real message + stack in
  the console) to begin phase-2 root-cause work.

## Functional requirements

### A. Surface the real load error (console + message + panel)
1. When `loadModel` (or the surrounding load flow in the offscreen document) throws, the
   offscreen document MUST log the actual `Error` — including its `message` and `stack` —
   via `console.error` in the offscreen console.
2. The `MODEL_STATUS` error message emitted to the service worker MUST carry a readable
   single-line message derived from the real error detail (the thrown `Error.message`), not
   only a generic fallback string. The generic fallback ("The model failed to load.") is
   used only when the thrown value has no usable message.
3. The service worker MUST relay the error `message` field of `MODEL_STATUS` through to the
   panel (via `STATE`/`MODEL_STATUS`) so the panel has the detail available. The persisted
   state snapshot MUST include the error message so a panel opened after the error still
   sees it.
4. The panel MUST render the load-error detail (the single-line message) plus a short "what
   to try" hint in a dedicated, visible error area — distinct from the generic one-line
   model-state banner — so the user sees the actual reason rather than only "Vidernu —
   model error, click to open the panel for details".
5. When the model transitions from `error` back to any non-error state (a fresh load
   begins), the panel MUST clear the previously shown error detail.

### B. Distinct "loading"/preparing state between download-complete and ready
6. After the model weights finish downloading and before the model is `ready`, the surfaced
   status MUST advance to `loading` (preparing/compiling), not remain `downloading` at
   100%. This MUST reuse the existing `loading` `ModelStatus` value already defined in the
   types/constants — no new status value is introduced.
7. The transformers.js terminal/`done` progress event MUST NOT be surfaced as
   `downloading`; `toLoadProgress` MUST map the `done` event to `loading`, and the offscreen
   document MUST post that `loading` status (the defect is that `loading` is defined but
   never surfaced in practice).
8. While in `loading`, the panel and badge MUST communicate a "preparing"/"loading" meaning
   distinct from the download-progress percentage (i.e. the UI must not read as
   "downloading 100%").
9. The `loading` state MUST be reachable and observable in the UI in a normal successful
   load (it must not be a state that is defined but never surfaced in practice).

### C. Load timeout (fail fast)
10. If the model load makes no progress toward `ready` within **120 seconds** of the last
    observed progress, the load MUST transition to `error` with a clear, actionable message
    indicating the load stalled/timed out and suggesting a next step (retry / reload).
11. The timeout is a **stall/inactivity timer**: it fires only when no progress is observed
    within the 120s window, and it MUST be reset on each observed progress update and
    cancelled when the model reaches `ready` (a successful load must never fire the timeout
    error afterward). It is NOT a hard overall cap on total load time.
12. Legitimate, actively-advancing download progress MUST NOT be killed by the timeout — the
    timer targets a *stall* (no advance for 120s), so a slow-but-live download that keeps
    emitting progress keeps resetting the timer.
13. A timeout error MUST leave the system able to retry a fresh load (the load singleton is
    cleared, as it already is on `catch`), i.e. the timeout must not permanently wedge the
    offscreen document.
14. The panel error area for a timeout (as for any load error, per FR-4) MUST expose a
    user-facing **"Retry"** control that re-triggers `LOAD_MODEL` from a clean state.

### D. Correct badge text for every state
15. The toolbar badge MUST show non-empty text whenever a model state exists, for every
    `ModelStatus` value: `standby` → "STBY", `downloading` → advancing percentage,
    `loading` → "PREP", `ready` → "READY", `error` → "ERR". No state — including `standby`
    and `error` — may map to empty badge text.
16. On service-worker start/restart and after extension reload, the badge MUST be set to
    reflect the current (or standby) state — it MUST NOT remain empty waiting for the first
    `MODEL_STATUS` push.
17. The badge for `error` MUST be visually distinct (its existing error color) and MUST show
    "ERR".

### E. Reliable initialization / re-initialization after restart or reload
18. On service-worker init, the offscreen message listener MUST be attached **before**
    `LOAD_MODEL` is sent, so the signal is never dropped because the listener did not yet
    exist.
19. On a **full extension reload** (chrome://extensions reload) or browser restart,
    `chrome.storage.session` is cleared and the offscreen document is torn down, so the
    system starts cold with no persisted status. The system MUST present a clean cold-start:
    a valid badge state (e.g. "STBY" then "PREP"), no stale/blank badge text, and a reliable
    `LOAD_MODEL` trigger with the listener attached first (per FR-18).
20. On a **service-worker-only idle-restart**, `chrome.storage.session` persists and the
    offscreen document survives with its in-memory pipeline intact, so a persisted `ready`
    remains valid; the system MUST reconcile the restored status against the offscreen
    document's actual state rather than blindly trusting or blindly discarding it. (The
    implementer MUST verify the SW-restart offscreen-survival assumption in code.)
21. As a safety net, if a user triggers analysis when the model is not actually loaded, the
    system MUST perform **lazy re-initialization** of the model (or present a clear
    non-stale state) — the user MUST NOT be left with a stale status and no progress.

## Edge cases
- Load throws with a non-`Error` value (string, object): message field falls back to the
  generic string; console still logs the raw thrown value.
- Load throws with an empty-string message: treated as no usable message → generic
  fallback.
- Timeout fires at nearly the same instant the model becomes `ready`: the terminal state
  must be deterministic (ready wins if it resolved first; otherwise error) and no dangling
  timer remains.
- A second `LOAD_MODEL` arrives while one is already in flight (e.g. restart racing a
  retry, or the Retry control pressed twice): must not spawn a duplicate load nor corrupt
  status; the in-flight load promise is reused (as `loadModel` already does).
- WebGPU-unavailable path: unchanged — still errors with the existing WebGPU message; the
  new error-detail rendering must handle this message too.
- Cache-Storage eviction between sessions: a fresh download is expected; status must pass
  through `downloading` → `loading` → `ready` correctly, not jump.
- Offscreen document torn down and recreated (full reload): the recreated document must
  attach its listener and be able to receive/act on `LOAD_MODEL` (ties to FR-18/FR-19).
- SW-only restart with offscreen document still alive: persisted `ready` is still valid and
  must be reconciled against the live offscreen state, not reset unnecessarily (FR-20).
- Panel opened *after* an error already occurred: `GET_STATE` reply must carry the error
  detail so the panel can render it (ties to FR-3).

## Acceptance criteria

### A. Real error surfaced
- **Given** the model load rejects with `new Error("boom")`, **when** the offscreen load
  flow handles it, **then** `console.error` is called with an argument whose message/stack
  includes "boom", and the emitted `MODEL_STATUS` has `status: "error"` and a single-line
  `message` containing "boom".
- **Given** the model load rejects with a non-`Error` value (e.g. the string `"weird"`),
  **when** handled, **then** `MODEL_STATUS.message` equals the generic fallback and the
  console still receives the raw thrown value.
- **Given** a `MODEL_STATUS` with `status:"error"` and `message:"boom"` reaches the service
  worker, **when** state is persisted and broadcast, **then** the persisted `STATE` snapshot
  and the broadcast message both carry `message:"boom"`.
- **Given** the panel receives an error state with `message:"boom"`, **when** it renders,
  **then** "boom" plus a short "what to try" hint appears in a dedicated error area distinct
  from the generic model-state banner.
- **Given** the panel is showing a load error, **when** a subsequent non-error status
  arrives, **then** the error area (message + hint) is cleared.

### B. Loading state
- **Given** the transformers.js progress callback emits its terminal/`done` event, **when**
  `toLoadProgress` maps it, **then** the surfaced status is `loading` (not `downloading` at
  100%), reusing the existing `loading` value.
- **Given** a normal successful load, **when** observed over time, **then** the status
  sequence includes `loading` strictly between the last `downloading` update and `ready`,
  and the offscreen document posts that `loading` status.
- **Given** status is `loading`, **when** the badge and panel render, **then** the badge
  reads "PREP" and the panel presents a "preparing"/"loading" meaning and does not read as
  "downloading 100%".

### C. Timeout
- **Given** a load that stops making progress, **when** 120s elapse with no further progress
  update and without reaching `ready`, **then** the status transitions to `error` with a
  message that names the stall/timeout and suggests retry/reload.
- **Given** a load that keeps emitting progress updates more often than every 120s, **when**
  it runs longer than 120s in total, **then** no timeout error is emitted (the stall timer
  is reset on each progress update).
- **Given** a load that reaches `ready` before the timeout, **when** the timeout duration
  later elapses, **then** no error is emitted and no dangling timer remains.
- **Given** a timeout error occurred, **when** the user presses "Retry" (or a new
  `LOAD_MODEL` is issued), **then** a fresh load starts from a clean state (the singleton
  was cleared) rather than immediately re-erroring.
- **Given** an error state is shown, **when** the panel renders, **then** a "Retry" control
  is present and re-triggers `LOAD_MODEL`.

### D. Badge
- **Given** each `ModelStatus` value, **when** `formatBadgeText` is called, **then** it
  returns non-empty text: `standby`→"STBY", `downloading`→"NN%", `loading`→"PREP",
  `ready`→"READY", `error`→"ERR".
- **Given** the service worker starts/restarts or the extension is reloaded, **when**
  `init()` runs, **then** the badge is set to reflect the current/standby state before any
  new `MODEL_STATUS` arrives (badge is never empty or blank).
- **Given** status is `error`, **when** the badge renders, **then** text is "ERR" with the
  error color.

### E. Restart / reload / re-init
- **Given** a full extension reload (session storage cleared, offscreen torn down), **when**
  `init()` runs, **then** the system cold-starts with a valid badge ("STBY"/"PREP"), no
  stale or blank badge text, and `LOAD_MODEL` is delivered to the offscreen listener.
- **Given** any service-worker init, **when** `init()` sends `LOAD_MODEL`, **then** the
  offscreen document's listener is already attached and receives/acts on it (delivery is not
  silently dropped because the listener was not yet attached).
- **Given** a service-worker-only idle-restart with the offscreen document still alive and a
  persisted `ready`, **when** `init()` runs, **then** the restored status is reconciled
  against the offscreen document's actual state (a still-valid `ready` is preserved rather
  than needlessly reset).
- **Given** the model is not actually loaded when the user triggers analysis, **when** the
  analysis request is handled, **then** the system lazily re-initializes the model (or shows
  a clear non-stale state) — the user is not left at a stale status with no progress.

## Non-functional requirements
- **Minimal footprint:** stay within the existing MV3 / offscreen-document architecture and
  the existing `ModelStatus` state machine; no new runtime dependencies.
- **Observability:** the offscreen console is the source of truth for full error detail
  (message + stack); the panel surfaces a user-appropriate single-line subset plus a hint.
- **No error suppression:** per AGENTS.md, surface failures — do not swallow or clean up
  output to hide them.
- **Testability:** the pure mappings (`toLoadProgress`, `formatBadgeText`/`Title`, error
  message derivation, message type guards) must be unit-testable without `chrome.*`; add
  failing-first tests for each fixed defect.
- **Quality gate:** `just check` must pass.
- **No regressions** to the analysis/inference path (latest-wins, per-analysis timeout) —
  the load timeout is separate from the per-analysis timeout.
- **Backward-compatible messaging:** if the `error` message must ride an existing field,
  prefer reusing the existing optional `MODEL_STATUS.message` / adding an optional field to
  `StateSnapshot` over a breaking change to the message union.

## Ratified decisions
All open questions were reviewed by the user, who accepted the recommended defaults. Each is
recorded below as a ratified, user-accepted decision.

- `[DECISION | user-accepted default]` **Load-timeout duration = 120s.** Folded into FR-10.
- `[DECISION | user-accepted default]` **Timer shape = stall/inactivity timer**, reset on
  each progress update; not a hard overall cap. Folded into FR-11/FR-12.
- `[DECISION | user-accepted default]` **Retry affordance = yes.** A user-facing "Retry"
  control is provided in the panel error state. Folded into FR-14.
- `[DECISION | user-accepted default]` **Error detail exposure:** log the full `Error`
  (message + stack) to the offscreen console via `console.error`; propagate a readable
  single-line message in the `MODEL_STATUS` error payload; render that message plus a short
  hint in the panel error area (not just the generic status line). Folded into FR-1–FR-4.
- `[DECISION | user-accepted default]` **`loading` state = reuse the existing value.** The
  existing `loading` `ModelStatus` is reused; the defect is that it is never surfaced — fix
  the `toLoadProgress` mapping of the `done` event and ensure the offscreen document posts
  it. No new status value. Folded into FR-6/FR-7.
- `[DECISION | user-accepted default]` **Phase-2 root-cause fix = out of scope.** This change
  makes the failure observable and fixes the load-lifecycle/status/badge/reload bugs; a
  follow-up change will fix the real load error once it is visible. Reflected in Objective.
- `[DECISION | user-accepted default]` **Re-init after reload:** attach the offscreen message
  listener before sending `LOAD_MODEL`; reconcile any restored status against the offscreen
  document's actual state; add lazy re-init on first analysis request as a safety net.
  Folded into FR-18/FR-20/FR-21.
- `[DECISION | user-accepted default]` **Badge text during `loading` = "PREP"**, and every
  state (including `standby` and `error`) maps to non-empty badge text. Folded into FR-15.

- `[DECISION | resolved by research]` **Persistence lifecycle across restart/reload.**
  `chrome.storage.session` persists across a service-worker idle-restart, and the offscreen
  document also survives a SW idle-restart (independent lifecycle) — so on a SW-only restart
  the in-memory model pipeline is retained and a persisted `ready` remains valid.
  `chrome.storage.session` is cleared on a full extension reload and on browser restart, and
  the offscreen document is torn down in both — so those paths start cold with no persisted
  status. Therefore there is **no** path that pairs a persisted `ready` with a dead pipeline
  via `storage.session`; the observed "stale status + empty badge after reload" is a
  fresh-start/badge-formatting bug, not stale-persistence. Reload requirements are scoped
  accordingly: FR-19 ensures a clean cold-start after full reload (valid badge, no stale
  text, reliable `LOAD_MODEL`), and FR-20 reconciles (rather than blindly resets) on the
  SW-only restart path. The implementer should still verify the SW-restart
  offscreen-survival assumption in code.

- `[ASSUMPTION | LOW]` The generic fallback string stays "The model failed to load." for
  non-`Error` throws; the timeout gets its own distinct message.
- `[ASSUMPTION | LOW]` No change to the per-analysis timeout — the load timeout is a
  separate constant.
