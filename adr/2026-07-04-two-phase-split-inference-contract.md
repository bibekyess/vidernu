---
title: Split the single combined inference contract into two independent phase contracts
date: 2026-07-04
status: Accepted
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
instructions only; it never embeds Phase-1 output (spec FR-B1a) — enforced structurally, because
`buildDetailPrompt(text, lang?)` has no third "translation" parameter through which a caller could
pass Phase-1 output; a `prompt.test.ts` assertion locks both the arity and the absence of
translation keys in the rendered prompt text. Each phase is bounded independently by the existing
TIMEOUT_MS (120s); a timeout in one is never attributed to the other. Contract-version note: this
is the v2 analysis contract; the v1 combined `AnalysisResult` contract is retired for the analysis
path (removed from schema.ts/messages.ts/prompt.ts/sanitize.ts).

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
- Two prompts and two validators must be maintained; the sanitize/repair core is generalized to a
  validator-parameterized `sanitizeAndParse<T>(raw, validate)` so both phases share it (operating
  on a complete response only — no streaming, spec FR-A6).
- The offscreen document stays single-generation and stateless: it selects prompt+validator by
  `phase` and retains no cross-phase state, preserving the v1 single-turn/no-KV-growth guarantee
  (v1 FR-6.25/FR-9) across the now-two generations per line.
- Multi-phase display state (which phase succeeded/failed, retry scoping) lives in the panel
  (`src/sidepanel/panel-state.ts`), not the offscreen — the sibling phase's result exists only in
  panel memory, so per-phase retry cannot disturb it.
- Extends adr/2026-07-03-offscreen-document-owns-webgpu-inference.md (same relay topology, second
  contract on top) and does not revisit the panel-injection or ORT-bundling ADRs.
