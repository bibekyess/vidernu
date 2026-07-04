---
title: Two-phase on-demand analysis, stop & retry controls, and panel UX polish
date: 2026-07-04
status: Ratified        # Draft | Ratified | Delivered
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
owner's previously-deferred "wow-effect" UX bar: tab-based section switching, section-level
loading (never a full-panel blocker), inline errors, a visible stop affordance, a distinctive
teal-on-charcoal visual identity, a persistent local/private indicator, and smooth, jank-free
transitions across the panel's content states. The value is responsiveness (quick things
first), user control (interrupt slow work, recover from failures without losing good results),
and a production-grade feel — all without weakening v1's privacy, local-only, and single-turn
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
- As a **learner who chose Vidernu because it runs privately on my own machine**, I want the
  panel to visibly reassure me that analysis stays local, so that its core advantage over
  server-backed competitors is obvious while I use it.

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
- **Analysis tabs** — the four content areas (Translation, Deconstruction, Context & Meaning,
  Grammar Notes) presented as switchable tabs within the panel rather than four permanently
  stacked sections (see Group E). "Tab" refers to a display/interaction affordance only; it
  does not change the two-phase generation contract (Phase 1 fills Translation; Phase 2 fills
  the other three together).

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
- **FR-B1a (detail-phase prompt is independent — settled).** The detail-phase (Phase 2)
  generation MUST run **independently over the captured source line only**. It MUST NOT receive
  the Phase-1 translation (or any other Phase-1 output) as prompt context or grounding. Each
  phase's prompt is constructed solely from the captured source line and its own phase-specific
  instructions. (Rationale and origin: see Ratified decisions. This keeps the two prompts truly
  separate and small, and matches the owner's "second, separate generation" framing.)
- **FR-B2 (per-shape validation & error fallback).** Each phase's raw model output MUST pass
  through sanitization/repair and be validated against its own shape (extending v1 FR-7.26/27).
  A phase whose output cannot be parsed/validated after repair MUST resolve to a well-formed,
  per-phase error state (Group D), never a crash, blank panel, or broken layout (v1 FR-7.28).
- **FR-B3 (per-phase timeout — settled at `TIMEOUT_MS`).** Each phase MUST be bounded by a
  timeout that resolves to the same per-phase error state rather than hanging (extending v1
  FR-7.29). Both phases MUST reuse the existing per-analysis `TIMEOUT_MS` (120s) as their bound;
  no separate or shorter quick-phase cap is introduced by this change (see Ratified decisions).
  The quick and detail phases are separately bounded (each gets its own 120s timer); a timeout
  in one MUST NOT be attributed to the other.
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
    breakdown again (the detail tabs are not left showing a spinner or a half-result).
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
  errored part (the quick-translation area / Translation tab, or the detail-breakdown tabs),
  consistent with the existing v1 FR-7.27/28 error-fallback rendering and the model-load Retry
  pattern already in the panel. It MUST NOT blank or disrupt the unaffected part of the panel
  (Group E).
- **FR-D4 (retry clears the failed partial state).** Activating Retry for a phase MUST clear that
  phase's prior error/partial state and show a fresh in-progress state for that phase; it MUST
  NOT leave stale error text alongside the new attempt, and it MUST NOT clear a successful other
  phase.
- **FR-D5 (retry is bounded like any attempt).** A retried generation is itself a normal phase
  attempt: it is bounded by the per-phase timeout (FR-B3), is stoppable (Group C), and can
  itself fail and re-offer Retry.

### Group E — Panel UX quality bar ("wow effect")

This group makes the previously-deferred UX ask testable. Exact visual values (pixels, spacing,
motion curves, iconography, exact copy) are the planner's/implementer's lane; the **creative
direction below is settled**, not open. The direction was informed by reviewing two real
competitor products (see Ratified decisions and "Competitive research context") **for feature
and pattern inspiration only — not to imitate their skin or brand**. Where a competitor pattern
is adopted, it is re-expressed in Vidernu's own distinctive identity.

- **FR-E1 (section-level loading, not a full-panel blocker).** Loading state MUST be confined to
  the phase/section that is generating. While the detail phase is generating, the quick
  translation (Translation tab) MUST remain visible and interactive; the panel MUST NOT replace
  the whole panel with a single blocking spinner. This **changes** v1 FR-5.20's single
  whole-panel in-progress indication into per-section in-progress indications.
- **FR-E2 (visible stop affordance during generation).** During a generation, a clearly-labeled
  and/or iconed Stop affordance MUST be visible for the running phase, presented alongside or in
  place of that phase's trigger control (FR-C1).
- **FR-E3 (inline errors with retry).** Errors MUST be shown **inline within the affected
  tab/section** with the Retry affordance (Group D), without blanking or jarring the rest of the
  panel.
- **FR-E4 (clear content-state model, no jank).** The panel MUST present a clear visual
  hierarchy across its content states and transition between them without layout jank (no
  abrupt reflow/flicker that degrades readability). Because translation and breakdown are now
  decoupled, the panel's states include at least: **idle/ready**, **quick-loading**,
  **quick-result (with detail available / detail tabs pending)**, **detail-loading (quick result
  still shown)**, and **result-with-error** (either phase errored). Each MUST be visually
  distinct and internally consistent.
- **FR-E5 (architecture unchanged).** This UX work MUST stay within the existing in-page
  injected-panel architecture that resizes YouTube's `#columns`
  (`adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md`); it does NOT revisit that
  decision, introduce an overlay, or move to `chrome.sidePanel`. The video MUST remain fully
  visible in the split view (v1 FR-5.18).
- **FR-E6 (tab-based section switching — updates/supersedes v1 FR-5.19's stacked display).**
  The four content areas (Translation, Deconstruction, Context & Meaning, Grammar Notes) MUST be
  presented as **switchable tabs**, not four permanently stacked sections. This **updates and
  supersedes only the display arrangement** described in v1 FR-5.19 (four permanently stacked
  distinct sections); every other aspect of v1 FR-5 — the split view that resizes `#columns`
  with the video fully visible (FR-5.18), the four content areas' meaning and English-output
  rule (FR-5.19a–d), source line shown verbatim, graceful degradation of an empty section
  (FR-5.21) — remains fully in force. Required tab behavior:
  - The **Translation tab** MUST be populated and active immediately after the quick phase
    succeeds (FR-A2).
  - The **Deconstruction**, **Context & Meaning**, and **Grammar Notes** tabs MUST be visibly
    present but in a **locked/pending** state until the detail phase completes; they then
    populate **together** (Phase 2 remains a single generation covering all three — this is a
    display/interaction change, not a re-split of the generation contract; see FR-B1 and
    Ratified decisions).
  - The **active tab** MUST be visually distinct from inactive tabs (per the settled palette in
    FR-E7); the pending/locked detail tabs MUST be visually distinguishable from both active and
    available-inactive tabs.
  - Each tab's content SHOULD begin with a short label above its body (a small uppercase,
    accent-colored heading) so the active section is self-identifying.
  - Deconstruction rows MUST be presented as individual **token-cards** (romanization/reading,
    the native-script token in a bordered/tinted box, and its English explanation grouped per
    token) rather than a plain undelimited table or list. (Pattern adopted from FlixFluent's
    deconstruction layout; re-expressed in Vidernu's palette per FR-E7.)
- **FR-E7 (distinctive visual identity — NOT a competitor's palette).** The panel MUST have an
  original visual identity that is deliberately **not** FlixFluent's (or Netflix's/YouTube's)
  oversaturated red-on-dark look. Settled creative direction (exact values left to the
  implementer):
  - Panel background MUST be a **charcoal/graphite** tone — not pure black, not navy.
  - **Teal MUST be the single primary accent color** for active/interactive elements: the active
    tab pill, primary buttons ("Analyze current line", "Show detailed breakdown"), focus states,
    and token-card accents.
  - **Red/orange MUST be reserved exclusively for error and stop/destructive states** (inline
    errors, the Stop control), so those remain visually unambiguous and never collide with the
    primary brand accent. Non-destructive interactive elements MUST NOT use red/orange as their
    primary color.
  - The active tab SHOULD read as a **filled accent-color (teal) pill with light text**;
    inactive tabs SHOULD read as **muted/dark pills** — the interaction *pattern* borrowed from
    FlixFluent's tabs, the *color* Vidernu's own.
- **FR-E8 (persistent local/private indicator).** The panel header MUST display a small,
  persistent indicator communicating that inference is fully local/private (short copy such as
  "Local · Private" or equivalent). It MUST be present across all content states (idle through
  result/error) and MUST NOT be styled as an error/warning (i.e. not red/orange per FR-E7). This
  surfaces Vidernu's structural advantage — 100% on-device, private, free inference (v1 FR-10) —
  directly in the UI rather than leaving it buried in an ADR. It is a static informational badge,
  not an interactive control, and makes no new privacy claim beyond v1's existing guarantee.

## Competitive research context (informational — bounds the creative direction)

Recorded so a future contributor understands *why* the Group E direction is what it is, and does
not "fix" it by regressing toward a competitor's execution. This is context, not a requirement.

- **FlixFluent** (a similar sidebar-based caption-analysis extension) was reviewed **for
  feature/pattern inspiration only, explicitly not to copy its visuals or brand**. Two useful
  patterns were extracted and adopted (re-skinned into Vidernu's identity): (1) presenting the
  four content areas as **tabs** rather than stacked sections (FR-E6), and (2) rendering
  deconstruction rows as **token-cards** (FR-E6). Its red-on-dark palette was **deliberately not
  adopted** (FR-E7).
- **Language Reactor, and the broader landscape (Trancy, Migaku, Sabi, InterSub)** were reviewed
  for **market context only**. Their common execution pattern — dense, continuous inline
  word-level popups and dual-subtitle overlays burned directly onto the video — reflects a
  **different interaction philosophy** than Vidernu's (one deeply-analyzed line via local LLM,
  on demand, in a side panel). This pattern was **considered and deliberately not adopted**; it
  MUST NOT be introduced as a "fix" without a new requirements pass (see "Considered, not
  adopted"). Vidernu's local/private/free inference is also a structural differentiator (Language
  Reactor sends data to a server; Trancy paywalls AI parsing) — surfaced via FR-E8.

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
- Copying any competitor's visual identity, palette, or brand (FR-E7); adopting inline
  per-word popups or dual-subtitle overlays (see "Considered, not adopted").

## Considered, not adopted (documentation only — not a roadmap commitment)

Feature ideas surfaced by the competitive research that are **not part of this change**. Listed
purely so they are on record and are not mistaken for gaps or oversights. Each would require its
own future requirements pass before it could be pursued; nothing here is committed or scheduled.

- **Hover-per-word instant dictionary popups** (Language Reactor / Trancy style inline lookups).
- **Dual-subtitle overlay burned onto the video** (source + translation over the player).
- **Sentence-mining / Anki flashcard export** of analyzed lines.
- **Hotkey-based sentence navigation** (jump between caption lines from the keyboard).
- **Multi-platform support** beyond YouTube (Netflix / Disney+ / Prime Video / Viki).

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
- **Quick phase succeeds, detail phase fails/times out.** Quick translation stays on the
  Translation tab; the detail tabs show an inline error with Retry for phase 2 only
  (FR-D2/FR-D3); the quick result is untouched.
- **Quick phase fails.** Inline error + Retry on the Translation tab; the "Show detailed
  breakdown" trigger is not offered (FR-A5); the detail tabs remain locked/pending and unpopulated.
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
- **Empty section within a valid detail response** (e.g. no grammar rules). That section's tab
  degrades cleanly ("not available") without breaking layout (v1 FR-5.21) — unchanged.
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
  Grammar Notes tabs populate for the same captured line, with the translation still shown.
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
- **Given** a triggered detail phase, **when** its prompt is constructed, **then** the prompt
  contains the captured source line and phase-2 instructions only, and does **not** embed the
  Phase-1 translation output (FR-B1a).
- **Given** either phase's output that cannot be parsed after sanitization/repair, **when** it is
  processed, **then** that phase resolves to a well-formed per-phase error state (not a crash or
  broken layout).
- **Given** either phase that exceeds its `TIMEOUT_MS` (120s) bound, **when** the timeout elapses,
  **then** that phase resolves to its per-phase error state rather than hanging, and the other
  phase's state is unaffected.
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
  **then** an inline Retry appears on the Translation tab and no detail trigger is offered;
  **when** the learner clicks Retry, **then** only the quick phase re-runs for the same captured
  line and the prior error state is cleared.
- **Given** a failed detail phase while the quick phase succeeded, **when** the panel renders,
  **then** an inline Retry appears on the detail tabs only, the quick translation stays visible;
  **when** the learner clicks Retry, **then** only the detail phase re-runs and the quick
  translation is neither re-run nor discarded.
- **Given** a Retry-triggered generation, **when** it is in flight, **then** it is itself
  stoppable and bounded by the per-phase timeout, and can re-offer Retry if it fails again.
- **Given** Retry is pressed twice quickly for the same phase, **when** handled, **then** no
  duplicate concurrent generation for that phase is spawned and state is not corrupted.

**UX quality bar (Group E)**
- **Given** a detail phase generating, **when** the panel renders, **then** loading is confined to
  the detail tabs, the quick translation stays visible and interactive on its tab, and there is
  no full-panel blocking spinner.
- **Given** an error in one phase, **when** it renders, **then** the error and its Retry appear
  inline within that phase's tab/section and the other phase's content is not blanked or disrupted.
- **Given** transitions between idle, quick-loading, quick-result, detail-loading, and error
  states, **when** the panel updates, **then** each state is visually distinct and transitions do
  not produce jarring layout jank.
- **Given** a successful quick phase, **when** the panel renders, **then** the four content areas
  appear as tabs (not stacked sections): the Translation tab is active and populated, and the
  Deconstruction / Context & Meaning / Grammar Notes tabs are visibly present but in a
  locked/pending state until the detail phase completes, at which point they populate together.
- **Given** a rendered detailed breakdown, **when** the Deconstruction tab is shown, **then** its
  rows appear as individual token-cards (token in a bordered/tinted box with reading and English
  explanation grouped per token), not as a plain undelimited table/list.
- **Given** the panel in any content state, **when** it renders, **then** the active tab / primary
  interactive elements use the teal primary accent, red/orange is used only for error and
  stop/destructive states, and the background is a charcoal/graphite (not pure black, navy, or a
  red-on-dark competitor palette).
- **Given** the panel in any content state (idle through result/error), **when** it renders,
  **then** the persistent local/private indicator is visible in the header and is not styled as
  an error/warning.
- **Given** any state of this flow, **when** the panel is shown, **then** the YouTube video
  remains fully visible in the resized `#columns` split view (no overlay, no architecture
  change).

## Non-functional requirements

- **Privacy (overriding, unchanged).** Both phases run on-device via WebGPU; no subtitle text,
  prompt, or output for either phase is transmitted off-device (v1 FR-10). The FR-E8 indicator
  restates this guarantee in the UI; it introduces no new claim.
- **Responsiveness.** The quick phase exists to deliver the translation with materially less wait
  than the v1 combined generation; the panel MUST give immediate per-section in-progress feedback
  and MUST never appear frozen. Exact latency depends on device GPU (not guaranteed to a fixed
  number), as in v1.
- **Footprint.** Two-phase does not weaken the footprint levers (v1 FR-9): still single-turn,
  stateless, bounded context, no KV-cache growth across phases.
- **Reliability / graceful degradation.** Every failure mode above resolves to a clear per-phase
  UI state — never a crash, hang, or broken layout; a failure in one phase never corrupts the
  other's state.
- **Accessibility.** The new tabs, Stop, "Show detailed breakdown", and Retry controls MUST be
  keyboard-operable with clear labels; tabs MUST expose their selected/pending/disabled state to
  assistive tech; state changes (loading → result/error) SHOULD be announced to assistive tech
  (e.g. a polite live region) so a non-visual user knows a phase finished or failed. The teal
  accent and charcoal background MUST meet the contrast and resizable-text requirements of the
  v1 accessibility NFR; color MUST NOT be the sole signal distinguishing error/stop states from
  interactive ones (pair with icon/label/text).
- **Testability.** Pure logic (the two schemas' validators, the two prompt builders, message
  type guards, phase/state derivation, active/pending tab derivation) MUST be unit-testable
  without `chrome.*`; add failing-first tests for the contract split and the stop/retry state
  transitions.
- **Quality gate.** `just check` MUST pass.
- **No regressions.** The model-load lifecycle, badge state machine, latest-wins supersession,
  and the load-timeout / model-load Retry from the two Delivered specs MUST continue to work; the
  per-phase analysis timeout is separate from the model-load stall timeout.
- **Backward-compatible messaging where practical.** Prefer extending the existing message union
  (e.g. a phase discriminator on the inference/result messages) over a gratuitously breaking
  redesign, consistent with the message-contract conventions already in `src/shared/messages.ts`
  — but this is guidance, not a constraint on the ADR's chosen shape.

## Ratified decisions

Decisions confirmed by the owner and now binding on the plan/implementation. These resolve the
questions this spec surfaced; the "(see Ratified decisions)" references throughout point here.

1. **Two-phase, on-demand flow.** Clicking "Analyze current line" runs the quick (translation)
   phase automatically; the detail (deconstruction + context + grammar) phase runs **only** on an
   explicit "Show detailed breakdown" action — never prefetched or run in the background
   (FR-A1/FR-A3).
2. **Single Phase-2 generation.** The three heavy sections are produced by **one** detail-phase
   generation (one call → deconstruction + context + grammar), not three separate calls
   (FR-B1). The tab-based display (decision 7) does not re-split this.
3. **Phase-2 prompt is independent — no Phase-1 context.** The detail phase runs independently
   over the captured source line only and does **not** receive the Phase-1 translation as
   grounding/context (FR-B1a). (Resolves the prior MEDIUM open question; the owner accepted the
   recommended default of a fully independent second generation.)
4. **Per-phase timeout = existing `TIMEOUT_MS` (120s) for both phases.** Both phases reuse the
   current 120s per-analysis bound; no separate or shorter quick-phase cap is introduced
   (FR-B3). (Resolves the prior LOW open question with the recommended default.)
5. **No token-by-token streaming of the JSON response.** Each phase is a discrete
   request → complete-response generation; the sanitize/repair pipeline operates on a complete
   response only (FR-A6).
6. **Soft/cooperative stop.** Stop halts generation at the next token boundary (no hard
   GPU-level abort); stopped output never surfaces (FR-C3/FR-C5).
7. **Tab-based display + distinctive identity + local/private badge (creative direction, settled).**
   The four content areas are shown as switchable tabs (Translation active after Phase 1; the
   three detail tabs locked/pending until Phase 2), **updating/superseding only v1 FR-5.19's
   stacked-section display** while keeping the rest of v1 FR-5 intact (FR-E6). Visual identity is
   charcoal/graphite with teal as the single primary accent and red/orange reserved for
   error/stop states (FR-E7). A persistent "Local · Private" (or equivalent) header indicator is
   added (FR-E8). Patterns (tabs, token-cards) were drawn from FlixFluent for **feature
   reference only**, not visual imitation; the inline-popup / dual-subtitle-overlay philosophy of
   Language Reactor and peers was considered and deliberately **not** adopted (see "Competitive
   research context" and "Considered, not adopted").

## Assumptions & open questions

All questions this spec surfaced have been resolved (see "Ratified decisions"); no open question
remains. The items below are low-impact UI assumptions the owner has accepted as sensible
defaults; each is reversible and none blocks acceptance.

- `[ASSUMPTION | accepted-by-user | LOW]` **Stopping the quick phase clears the analyzed-line
  label** and returns to a clean "ready to analyze" state (no partial result shown), rather than
  retaining the in-progress line label with an empty result.
- `[ASSUMPTION | accepted-by-user | LOW]` **A fresh "Analyze current line" while a detail
  breakdown is shown replaces the whole panel content** (all tabs) for the new line — the
  previous line's translation and breakdown are cleared, consistent with latest-wins (FR-A8).
- `[ASSUMPTION | accepted-by-user | LOW]` **Exact visual values (spacing, motion, iconography,
  exact copy, precise teal/charcoal hex) are the implementer's lane**, guided by Group E's
  settled creative direction; this spec sets behavioral and directional requirements, not a
  pixel spec.
- `[ASSUMPTION | accepted-by-user | LOW]` **Collapse/expand of an already-rendered detail
  breakdown, if offered, is a pure-UI nicety** with no new generation (FR-A9); not required for
  acceptance.
