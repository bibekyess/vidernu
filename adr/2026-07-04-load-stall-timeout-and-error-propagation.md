---
title: Model-load stall timeout and error-detail propagation contract
date: 2026-07-04
status: Accepted
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
