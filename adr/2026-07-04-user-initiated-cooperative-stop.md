---
title: User-initiated Stop reuses cooperative supersession, not a hard GPU abort
date: 2026-07-04
status: Accepted
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
- `cancelledRequestId` is reset to `null` at the start of every `handleRunInference` for the new
  request id, so a stale cancel can never suppress a later legitimate result (covered by an
  offscreen test that reuses a requestId to exercise this defensively, even though the real
  monotonic counter never actually repeats an id in production).
- The panel transitions its own UI **optimistically on the Stop click** (it is authoritative over
  its own DOM) and invalidates that phase's latest requestId to a never-sent sentinel, so even a
  result that raced the stop is dropped panel-side. Stopping detail leaves the quick translation
  intact; stopping quick returns to a fresh "ready to analyze" state.
The documented constraint from adr/2026-07-03-offscreen-document-owns-webgpu-inference.md remains
accurate and acceptable: cancellation is cooperative — a kernel in flight completes, no further
tokens are produced, "promptly" means next token boundary, not instantaneous.

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
  path (`isSuperseded` in `src/offscreen/offscreen.ts`).
- A brief window exists where a cancelled generation is still producing its final token(s); its
  output is discarded twice (SW drops the superseded post; panel drops by stale id), satisfying
  FR-C5 deterministically for the "stop a beat before completion" edge case.
- The offscreen gains one module-scoped `cancelledRequestId` that must be reset per new request so
  a stale cancel never suppresses a later legitimate result — covered by
  `test/offscreen.test.ts`.
