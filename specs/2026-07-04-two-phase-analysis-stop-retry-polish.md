---
title: Two-phase on-demand analysis, stop & retry controls, and panel UX polish
date: 2026-07-04
status: Draft        # Draft | Ratified | Delivered
---

# 2026-07-04 — Two-phase on-demand analysis, stop & retry controls, and panel UX polish

## Objective

Vidernu's delivered v1 produces a single-shot, four-section grammatical breakdown from one
model generation (v1 spec FR-5/FR-6). On integrated GPUs that one generation is slow (the
per-analysis cap is 120s — see `TIMEOUT_MS`), so a learner who only wants a quick sense of
what a line means still pays for the full deconstruction, waits with nothing on screen, and
has no way to interrupt a slow or wedged generation. This change reshapes the analysis
interaction into **two phases** — an immediate, cheap **quick translation**, and an
**on-demand detailed breakdown** the learner explicitly requests only when they want it —
and adds first-class **stop** (cancel an in-flight generation) and per-phase **retry**
(recover from an errored/empty/hung generation) controls. It also folds in the product
owner's previously-deferred "wow-effect" UX bar: section-level loading (never a full-panel
blocker), inline errors, a visible stop affordance, and smooth, jank-free transitions
across the panel's content states. The value is responsiveness (quick things first), user
control (interrupt slow work, recover from failures without losing good results), and a
production-grade feel — all without weakening v1's privacy, local-only, and single-turn
stateless guarantees.

**This spec builds on and extends the Delivered v1 spec**
(`specs/2026-07-03-vidernu-youtube-language-learning-extension.md`). It does **not** restate
v1's still-valid requirements. It references the v1 FR-5 (side-panel split view), FR-6
(inference contract / four-section JSON), FR-7 (sanitize/repair/error fallback), and FR-4.17
(latest-wins supersession) families and states precisely what is **added**, **changed**, or
**superseded**. All v1 requirements not touched here remain in force — in particular the
privacy/local-only guarantee (v1 FR-10), on-device WebGPU inference (v1 FR-6.22), single-turn
stateless inference with no KV-cache growth (v1 FR-6.25 / FR-9), the language scope and
English-output rule (v1 FR-8), caption capture (v1 FR-3), and the in-page injected panel that
resizes YouTube's `#columns` (v1 FR-5.18 and `adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md`,
which this change does **not** revisit).

## User stories

- As a **learner who mostly just wants to know what a line means**, I want the translation to
  appear quickly after I click "Analyze current line", without waiting for the full
  grammatical deconstruction, so that I get the answer I usually need first and fast.
- As a **learner who wants to go deeper on a specific line**, I want an explicit "Show
  detailed breakdown" action that runs the heavier deconstruction / context / grammar
  analysis only when I ask for it, so that the expensive generation never runs unless I
  actually want it.
- As a **learner whose generation is slow or stuck**, I want a visible Stop control that
  promptly halts the current generation and returns the panel to a usable state, so that I am
  never trapped waiting on a call I no longer want.
- As a **learner whose translation still matters after I stop the deeper analysis**, I want
  stopping the detailed breakdown to leave my already-shown quick translation intact, so that
  I don't lose good results by cancelling the part I didn't want.
- As a **learner whose analysis errored, returned garbled output, or hung**, I want an inline
  Retry control on the affected part only, so that I can recover a failed translation or a
  failed breakdown without re-running the part that already succeeded.
- As a **learner using the panel**, I want smooth, professional transitions between idle,
  loading, result, and error states — with loading confined to the section that is working,
  not a blank full-panel spinner — so that the tool feels polished and never janky.

## Definitions

- **Quick phase (Phase 1)** — the analysis that runs automatically when the learner clicks
  "Analyze current line". It produces **only the translation** (literal + natural English
  renderings of the captured source line). It uses a smaller/faster prompt than v1's combined
  prompt.
- **Detail phase (Phase 2)** — the analysis that runs **only** when the learner explicitly
  activates "Show detailed breakdown". It produces the three "heavy" sections from v1's
  four-section design: **Deconstruction**, **Context & Meaning**, and **Grammar Notes**.
- **Captured line** — the exact caption text captured at the moment "Analyze current line" was
  clicked (v1 FR-4.15). Both phases for one analysis operate on the same captured line.

## Functional requirements

Requirements are grouped. Each is a testable statement of **what** Vidernu must do — not how.
Numbering is local to this spec (FR-A1, FR-B2, …). References like "v1 FR-6.23" point at the
Delivered v1 spec.

### Group A — Two-phase, on-demand analysis flow

- **FR-A1 (quick phase, automatic).** Clicking "Analyze current line" MUST trigger **only** the
  quick phase: a single model generation that returns the translation (literal + natural) for
  the captured line, and nothing else. This **supersedes** v1 FR-6.23's single combined
  four-section generation as the response to that click.
- **FR-A2 (quick result rendered immediately).** When the quick phase completes successfully,
  the panel MUST render the translation (literal vs. natural, in English, source line shown
  verbatim per v1 FR-5.19a) as soon as it is available — it MUST NOT wait for any detail-phase
  work.
- **FR-A3 (detail phase is explicit and on-demand).** After a successful quick phase, the panel
  MUST present an explicit action (e.g. "Show detailed breakdown"). The detail phase — a
  **second, separate** model generation producing Deconstruction, Context & Meaning, and
  Grammar Notes — MUST run **only** when the learner activates that action. Vidernu MUST NOT
  eagerly prefetch, speculatively start, or run the detail phase in the background before it is
  requested. This is a settled decision (see Ratified decisions), motivated by resource use and
  the "quick things first" intent.
- **FR-A4 (detail operates on the same captured line).** When the detail phase runs, it MUST
  analyze the **same captured line** that the quick phase analyzed (v1 FR-4.15), NOT whatever
  caption happens to be on screen when "Show detailed breakdown" is clicked. The panel MUST
  keep displaying which line the results are for (v1 FR-5.19 / FR-4.15).
- **FR-A5 (detail trigger gated on a successful quick result).** The "Show detailed breakdown"
  action MUST be available only once a valid quick translation is shown. If the quick phase has
  not succeeded (still running, errored, or not yet started), the detail trigger MUST NOT be
  offered as an active control.
- **FR-A6 (two discrete generations, no streaming).** Each phase MUST be its own discrete
  request → complete-response generation. Vidernu MUST NOT render partial/incomplete JSON
  mid-stream. Token-by-token streaming of the structured (JSON) response is explicitly out of
  scope (see Ratified decisions) — the existing sanitize/repair pipeline (v1 FR-7) operates on
  a **complete** response only.
- **FR-A7 (single-turn statelessness preserved).** Each phase MUST remain a single-turn,
  stateless inference over one line (v1 FR-6.25 / FR-9): no conversational history or KV-cache
  may accumulate across phases or across successive line analyses. Running two phases for one
  line MUST NOT introduce cross-request state growth.
- **FR-A8 (latest-wins across phases).** Triggering a new quick analysis (a fresh "Analyze
  current line") while any phase of a prior analysis is in flight or displayed MUST supersede
  the prior analysis entirely (both phases), consistent with v1 FR-4.17: the panel MUST end up
  reflecting only the newest requested line, with no stale or interleaved quick or detail
  output from the superseded analysis.
- **FR-A9 (no regenerate-on-success).** Once the detail phase has succeeded, Vidernu is NOT
  required to offer a "regenerate for different phrasing" control. Re-running a *successful*
  result is out of scope; the only re-run paths are failure recovery (Group D) and starting a
  fresh analysis (FR-A1). Collapsing/expanding an already-rendered breakdown is a pure-UI
  affordance left to the implementer.

### Group B — Split inference contract (schema + prompt)

- **FR-B1 (two contracts).** The single combined v1 JSON schema (v1 FR-6.23) MUST be **split**
  into two independent request/response shapes: a **quick-translation** shape carrying the
  translation (`{ literal, natural }`) and a **detailed-breakdown** shape carrying the three
  heavy sections (`deconstruction[]`, `context`, `grammar_rules[]`). Each phase uses its own
  prompt and its own response contract. The union of the two shapes MUST be equivalent in
  content coverage to v1's four sections (no section is dropped; they are redistributed across
  two phases).
- **FR-B2 (per-shape validation & error fallback).** Each phase's raw model output MUST pass
  through sanitization/repair and be validated against its own shape (extending v1 FR-7.26/27).
  A phase whose output cannot be parsed/validated after repair MUST resolve to a well-formed,
  per-phase error state (Group D), never a crash, blank panel, or broken layout (v1 FR-7.28).
- **FR-B3 (per-phase timeout).** Each phase MUST be bounded by a timeout that resolves to the
  same per-phase error state rather than hanging (extending v1 FR-7.29). The quick and detail
  phases are separately bounded; a timeout in one MUST NOT be attributed to the other.
- **FR-B4 (contract change is an ADR — flag for the implementer).** Splitting the inference
  contract into two request/response shapes is a **cross-cutting interface change** to the
  shared schema (`src/shared/schema.ts`), the message union (`src/shared/messages.ts`), and
  prompt construction (`src/shared/prompt.ts`), and therefore **requires a short ADR** recorded
  in the same change (AGENTS.md). The ADR's key point: the FR-6 combined schema is split into
  two independent, phase-specific request/response shapes (quick-translation vs.
  detailed-breakdown), with a schema/contract-version note. This spec does **not** draft the
  ADR. The ADR is expected to **extend** — not supersede — the two v1 ADRs: the
  offscreen-document-owns-inference relay architecture
  (`adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`) and the in-page injected panel
  (`adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md`) both remain valid; the
  new ADR adds a second inference contract on top of them. The implementer MUST confirm the
  extend-vs-supersede relationship when writing it. (Exact message-type shapes — a `phase`
  discriminator vs. distinct message types — are the planner's lane.)

### Group C — Stop: cancel an in-flight generation

- **FR-C1 (stop control visibility).** A Stop control MUST be visible **only while a generation
  is in flight**, and MUST target whichever phase is currently running (quick or detail). When
  no generation is in flight, no Stop control is shown.
- **FR-C2 (both phases stoppable).** The learner MUST be able to stop the quick-phase generation
  and the detail-phase generation. (The primary motivating case is a slow detail breakdown; the
  quick phase is stoppable too, for consistency.)
- **FR-C3 (prompt halt at a token boundary).** Activating Stop MUST halt the in-flight
  generation promptly — at the next token boundary. Vidernu MUST NOT claim or imply a hard
  GPU-level abort; cancellation is cooperative/soft (a WebGPU kernel in flight completes but no
  further tokens are produced), consistent with
  `adr/2026-07-03-offscreen-document-owns-webgpu-inference.md`. "Promptly" means at the next
  token boundary, not instantaneously mid-kernel.
- **FR-C4 (UI returns to a clean state on stop).**
  - Stopping the **detail phase** MUST leave the already-rendered **quick translation visible
    and intact**, and return the panel to a state where the learner can request the detailed
    breakdown again (the detail section is not left showing a spinner or a half-result).
  - Stopping the **quick phase** MUST return the panel to a fresh **"ready to analyze"** state:
    no quick result, no detail result, no lingering in-progress indicator, and the "Analyze
    current line" trigger available again.
- **FR-C5 (stopped output never surfaces).** A stopped generation's eventual or discarded output
  MUST never appear in the panel after the fact (no late-arriving result for a stopped call may
  render). This extends the v1 latest-wins discard guarantee (v1 FR-4.17) to explicit
  user-initiated stops.
- **FR-C6 (mechanism left to the plan).** This spec specifies the **user-facing behavior** of
  Stop, not its internal mechanism. Whether the implementation reuses/extends the existing
  latest-wins supersession plumbing (the `superseded`/`requestId` pattern and the polled
  `InterruptableStoppingCriteria`) or adds an explicit user-initiated cancel message is the
  planner's/implementer's decision, provided FR-C1–FR-C5 hold.

### Group D — Retry: recover from error / empty output / hang

- **FR-D1 (retry is failure recovery only).** Retry MUST be offered for failure states —
  model/generation errors, empty or garbled output that fails schema validation after
  sanitization (v1 FR-7), and hung/timed-out calls (FR-B3). Retry is **not** a
  "regenerate a successful result for different phrasing" feature (see FR-A9).
- **FR-D2 (per-phase retry).**
  - If the **quick phase** fails, Retry MUST re-run **only the quick phase** for the same
    captured line (FR-A4).
  - If the **detail phase** fails while the quick phase succeeded, Retry MUST re-run **only the
    detail phase** — it MUST NOT re-run or discard the already-good quick translation.
- **FR-D3 (retry appears inline on the affected part).** The Retry affordance MUST appear on the
  errored part (the quick-translation area or the detail-breakdown area), consistent with the
  existing v1 FR-7.27/28 error-fallback rendering and the model-load Retry pattern already in
  the panel. It MUST NOT blank or disrupt the unaffected part of the panel (Group E).
- **FR-D4 (retry clears the failed partial state).** Activating Retry for a phase MUST clear that
  phase's prior error/partial state and show a fresh in-progress state for that phase; it MUST
  NOT leave stale error text alongside the new attempt, and it MUST NOT clear a successful other
  phase.
- **FR-D5 (retry is bounded like any attempt).** A retried generation is itself a normal phase
  attempt: it is bounded by the per-phase timeout (FR-B3), is stoppable (Group C), and can
  itself fail and re-offer Retry.

### Group E — Panel UX quality bar ("wow effect")

These make the previously-deferred UX ask testable where reasonable; exact visual design is the
implementer's lane, but the following behaviors are required.

- **FR-E1 (section-level loading, not a full-panel blocker).** Loading state MUST be confined to
  the phase/section that is generating. While the detail phase is generating, the quick
  translation MUST remain visible and interactive; the panel MUST NOT replace the whole panel
  with a single blocking spinner. This **changes** v1 FR-5.20's single whole-panel in-progress
  indication into per-section in-progress indications.
- **FR-E2 (visible stop affordance during generation).** During a generation, a clearly-labeled
  and/or iconed Stop affordance MUST be visible for the running phase, presented alongside or in
  place of that phase's trigger control (FR-C1).
- **FR-E3 (inline errors with retry).** Errors MUST be shown **inline within the affected
  section** with the Retry affordance (Group D), without blanking or jarring the rest of the
  panel.
- **FR-E4 (clear content-state model, no jank).** The panel MUST present a clear visual
  hierarchy across its content states and transition between them without layout jank (no
  abrupt reflow/flicker that degrades readability). Because translation and breakdown are now
  decoupled, the panel's states include at least: **idle/ready**, **quick-loading**,
  **quick-result (with detail available)**, **detail-loading (quick result still shown)**, and
  **result-with-error** (either phase errored). Each MUST be visually distinct and internally
  consistent.
- **FR-E5 (architecture unchanged).** This UX work MUST stay within the existing in-page
  injected-panel architecture that resizes YouTube's `#columns`
  (`adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md`); it does NOT revisit that
  decision, introduce an overlay, or move to `chrome.sidePanel`. The video MUST remain fully
  visible in the split view (v1 FR-5.18).

## Out of scope

- Token-by-token streaming of the JSON response (explicitly rejected — FR-A6 / Ratified
  decisions). If a future text-only (non-JSON) surface is added, streaming could be revisited
  then, but it is not part of this change.
- "Regenerate a successful result" for alternative phrasings (FR-A9).
- Prefetching / background pre-warming of the detail phase (FR-A3).
- Persisting analysis results (quick or detail) across sessions — unchanged from v1 (still no
  persistence).
- Any new trigger mechanism beyond the in-panel buttons (hotkey, click-on-caption) — still
  deferred per v1.
- Revisiting the panel-injection / `#columns` architecture (FR-E5).
- Changing the model, device backend, language scope, or English-output rule (v1 FR-8 stands).

## Edge cases

- **Stop pressed a beat before the generation naturally completes.** The terminal state MUST be
  deterministic — either the result renders (if it resolved first) or the stop wins and no
  result renders; no dangling in-progress indicator and no late result leaks (FR-C5).
- **New "Analyze current line" clicked while a detail phase is in flight for the prior line.**
  Latest-wins: the prior analysis (both phases) is superseded; the panel shows only the new
  line's quick flow (FR-A8).
- **"Show detailed breakdown" clicked, then the video advances to a different caption.** The
  detail phase still analyzes the originally captured line, and the panel still labels the
  result with that line (FR-A4).
- **Quick phase succeeds, detail phase fails/times out.** Quick translation stays; the detail
  section shows an inline error with Retry for phase 2 only (FR-D2/FR-D3); the quick result is
  untouched.
- **Quick phase fails.** Inline error + Retry for phase 1; the "Show detailed breakdown" trigger
  is not offered (FR-A5); no detail section is shown.
- **Retry pressed twice quickly on the same phase.** Must not spawn duplicate concurrent
  generations for that phase nor corrupt state (consistent with the existing double-trigger
  guards); latest attempt governs.
- **Stop pressed when nothing is in flight (e.g. a stale click after completion).** No-op; must
  not error or wipe a shown result.
- **Model not `ready` when "Show detailed breakdown" or a Retry is activated.** Same behavior as
  the existing analysis path: lazy re-init / a clear non-stale state (v1 FR-21), not a silent
  hang.
- **Unvalidated (non-Korean/Japanese) source language.** Both phases still run best-effort in
  English with the "not fully validated for this language" note (v1 FR-8.31); an unparseable
  phase output falls through to that phase's error state.
- **Empty section within a valid detail response** (e.g. no grammar rules). That section degrades
  cleanly ("not available") without breaking layout (v1 FR-5.21) — unchanged.
- **Panel closed/reopened, or YouTube SPA navigation, mid-flow.** No zombie observers or late
  results into a torn-down panel; consistent with v1 panel-lifecycle handling.
- **Stopping the quick phase, then immediately re-triggering analysis.** The re-trigger starts a
  clean quick phase; no residue of the stopped attempt (FR-C4 + FR-A8).

## Acceptance criteria

Binary and testable, in Given/When/Then form.

**Two-phase flow (Group A)**
- **Given** the model is ready and a caption is on screen, **when** the learner clicks "Analyze
  current line", **then** exactly one generation runs and the panel renders the translation
  (literal + natural) only, with a "Show detailed breakdown" action offered and no
  deconstruction/context/grammar generated yet.
- **Given** a shown quick translation, **when** the learner does nothing further, **then** no
  detail-phase generation runs (it is never prefetched in the background).
- **Given** a shown quick translation, **when** the learner activates "Show detailed breakdown",
  **then** a second, separate generation runs and the Deconstruction, Context & Meaning, and
  Grammar Notes sections render for the same captured line, with the translation still shown.
- **Given** the video has advanced to a different caption after the quick phase, **when** the
  learner activates "Show detailed breakdown", **then** the detail phase analyzes the originally
  captured line (not the current on-screen caption) and the panel labels the result with that
  line.
- **Given** a quick or detail phase in flight, **when** the learner triggers a fresh "Analyze
  current line" for a newer line, **then** the panel ends up showing only the newest line's
  quick flow with no stale/interleaved output from the superseded analysis.
- **Given** many two-phase analyses in one session, **when** memory behavior is observed,
  **then** no conversational history or KV-cache accumulates across phases or across analyses
  (each phase is single-turn and stateless).

**Split contract (Group B)**
- **Given** a triggered quick phase, **when** it runs, **then** it uses the quick-translation
  prompt/shape and returns only the translation fields; **and given** a triggered detail phase,
  **when** it runs, **then** it uses the detailed-breakdown prompt/shape and returns only the
  three heavy sections.
- **Given** either phase's output that cannot be parsed after sanitization/repair, **when** it is
  processed, **then** that phase resolves to a well-formed per-phase error state (not a crash or
  broken layout).
- **Given** either phase that exceeds its timeout, **when** the timeout elapses, **then** that
  phase resolves to its per-phase error state rather than hanging, and the other phase's state
  is unaffected.
- **Given** the change is implemented, **when** the PR is reviewed, **then** it includes an ADR
  recording the split of the inference contract into two request/response shapes and stating
  whether it extends or supersedes the v1 ADRs.

**Stop (Group C)**
- **Given** no generation is in flight, **when** the panel renders, **then** no Stop control is
  shown; **given** a phase is generating, **when** the panel renders, **then** a Stop control for
  that phase is visible.
- **Given** a detail phase in flight over a visible quick translation, **when** the learner
  clicks Stop, **then** the generation halts promptly (at a token boundary), the quick
  translation remains visible and intact, and the panel returns to a state where the detailed
  breakdown can be requested again.
- **Given** a quick phase in flight, **when** the learner clicks Stop, **then** the generation
  halts promptly and the panel returns to a fresh "ready to analyze" state with no partial
  result and no lingering in-progress indicator.
- **Given** a generation that was stopped, **when** any output for that stopped call would
  otherwise arrive, **then** it is discarded and never rendered in the panel.

**Retry (Group D)**
- **Given** a failed quick phase (error, empty/garbled, or timeout), **when** the panel renders,
  **then** an inline Retry appears on the quick-translation area and no detail trigger is
  offered; **when** the learner clicks Retry, **then** only the quick phase re-runs for the same
  captured line and the prior error state is cleared.
- **Given** a failed detail phase while the quick phase succeeded, **when** the panel renders,
  **then** an inline Retry appears on the detail-breakdown area only, the quick translation stays
  visible; **when** the learner clicks Retry, **then** only the detail phase re-runs and the
  quick translation is neither re-run nor discarded.
- **Given** a Retry-triggered generation, **when** it is in flight, **then** it is itself
  stoppable and bounded by the per-phase timeout, and can re-offer Retry if it fails again.
- **Given** Retry is pressed twice quickly for the same phase, **when** handled, **then** no
  duplicate concurrent generation for that phase is spawned and state is not corrupted.

**UX quality bar (Group E)**
- **Given** a detail phase generating, **when** the panel renders, **then** loading is confined to
  the detail section, the quick translation stays visible and interactive, and there is no
  full-panel blocking spinner.
- **Given** an error in one phase, **when** it renders, **then** the error and its Retry appear
  inline within that phase's section and the other phase's content is not blanked or disrupted.
- **Given** transitions between idle, quick-loading, quick-result, detail-loading, and error
  states, **when** the panel updates, **then** each state is visually distinct and transitions do
  not produce jarring layout jank.
- **Given** any state of this flow, **when** the panel is shown, **then** the YouTube video
  remains fully visible in the resized `#columns` split view (no overlay, no architecture
  change).

## Non-functional requirements

- **Privacy (overriding, unchanged).** Both phases run on-device via WebGPU; no subtitle text,
  prompt, or output for either phase is transmitted off-device (v1 FR-10).
- **Responsiveness.** The quick phase exists to deliver the translation with materially less wait
  than the v1 combined generation; the panel MUST give immediate per-section in-progress feedback
  and MUST never appear frozen. Exact latency depends on device GPU (not guaranteed to a fixed
  number), as in v1.
- **Footprint.** Two-phase does not weaken the footprint levers (v1 FR-9): still single-turn,
  stateless, bounded context, no KV-cache growth across phases.
- **Reliability / graceful degradation.** Every failure mode above resolves to a clear per-phase
  UI state — never a crash, hang, or broken layout; a failure in one phase never corrupts the
  other's state.
- **Accessibility.** The new Stop, "Show detailed breakdown", and Retry controls MUST be
  keyboard-operable with clear labels; state changes (loading → result/error) SHOULD be
  announced to assistive tech (e.g. a polite live region) so a non-visual user knows a phase
  finished or failed. Contrast and resizable text per v1 accessibility NFR.
- **Testability.** Pure logic (the two schemas' validators, the two prompt builders, message
  type guards, phase/state derivation) MUST be unit-testable without `chrome.*`; add
  failing-first tests for the contract split and the stop/retry state transitions.
- **Quality gate.** `just check` MUST pass.
- **No regressions.** The model-load lifecycle, badge state machine, latest-wins supersession,
  and the load-timeout / model-load Retry from the two Delivered specs MUST continue to work; the
  per-phase analysis timeout is separate from the model-load stall timeout.
- **Backward-compatible messaging where practical.** Prefer extending the existing message union
  (e.g. a phase discriminator on the inference/result messages) over a gratuitously breaking
  redesign, consistent with the message-contract conventions already in `src/shared/messages.ts`
  — but this is guidance, not a constraint on the ADR's chosen shape.

## Assumptions & open questions

Settled items from the confirmed Q&A are recorded under "Ratified decisions". The items below
are this spec's own newly-surfaced questions and accepted defaults, ranked by impact. Per the
gate, this spec is **Draft** until the outstanding `[OPEN QUESTION]` items are resolved or
explicitly accepted.

- `[OPEN QUESTION | MEDIUM]` **Does the detail-phase (Phase 2) prompt receive the Phase-1
  translation as grounding context, or is it fully independent over the source line?** Both are
  compatible with single-turn statelessness (feeding the translation as prompt *text* is not
  KV-cache/history accumulation). Feeding it in could make the breakdown more consistent with the
  shown translation; keeping Phase 2 independent keeps prompts smaller and truly "separate".
  **Recommended default:** Phase 2 is **independent over the captured source line only** (no
  Phase-1 output injected), matching the owner's "second, separate generation" framing; the
  planner MAY pass the translation as read-only context if it demonstrably improves coherence
  without bloating the prompt. → routed as **NEEDS DECISION**.
- `[OPEN QUESTION | LOW]` **Per-phase timeout values.** **Recommended default:** reuse the
  existing single per-analysis `TIMEOUT_MS` (120s) as the bound for *each* phase; optionally the
  planner introduces a shorter bound for the quick phase (since it is a smaller prompt) to keep
  "quick things first" honest. Non-foreclosing; flagging in case the owner wants a specific quick
  cap. → routed as **NEEDS DECISION** (low).
- `[ASSUMPTION | LOW]` **Stopping the quick phase clears the analyzed-line label** and returns to
  a clean "ready to analyze" state (no partial result shown), rather than retaining the
  in-progress line label with an empty result. Reversible UI detail.
- `[ASSUMPTION | LOW]` **A fresh "Analyze current line" while a detail breakdown is shown
  replaces the whole panel content** (both sections) for the new line — the previous line's
  translation and breakdown are cleared, consistent with latest-wins (FR-A8).
- `[ASSUMPTION | LOW]` **The three heavy sections are produced by a single Phase-2 generation**
  (one call → deconstruction + context + grammar), not three separate calls. This matches the
  owner's framing and keeps the on-demand cost to one extra generation.
- `[ASSUMPTION | LOW]` **Exact visual design (spacing, motion, iconography, copy) is the
  implementer's lane**, guided by Group E and "insight from production-ready applications"; this
  spec sets behavioral requirements, not a pixel spec.
- `[ASSUMPTION | LOW]` **Collapse/expand of an already-rendered detail breakdown, if offered, is a
  pure-UI nicety** with no new generation (FR-A9); not required for acceptance.
