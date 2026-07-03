---
title: Vidernu — privacy-first local-inference language-learning Chrome extension for YouTube
date: 2026-07-03
status: Ratified        # Draft | Ratified | Delivered
---

# 2026-07-03 — Vidernu: privacy-first local-inference language-learning Chrome extension for YouTube

## Objective

Language learners who watch foreign-language YouTube videos with captions on lack an
in-context way to understand *why* a line means what it means — the grammar, particles,
honorifics, tone, and literal-vs-natural translation — without leaving the video, pasting
text into a cloud translator, or paying for a service that harvests their data. **Vidernu**
is a Manifest V3 Chrome extension that lets a learner, while watching a YouTube video with
captions on, trigger analysis of the single currently-active subtitle line and receive a
structured grammatical/translation breakdown in a side panel — generated **entirely
on-device** by a small instruction-tuned LLM running in the browser via WebGPU. The value
is privacy (no data leaves the browser), zero cost (no server, no API keys), and pedagogy
(a structured breakdown, not just a translation). This spec covers **v1**.

## User stories

- As a **language learner watching a captioned YouTube video**, I want to trigger analysis
  of the line currently on screen and see its translation, token-by-token grammatical
  breakdown, tone/formality, and the grammar rules it uses, so that I understand the
  sentence deeply without leaving the video or using a cloud service.
- As a **privacy-conscious user**, I want all analysis to run locally in my browser with
  nothing sent to any server, so that my viewing and study activity never leaves my device.
- As a **cost-averse hobbyist**, I want the extension to work with no account, no API key,
  and no subscription, so that I can use it freely and indefinitely.
- As a **first-time user after installing**, I want the model to download in the background
  with clear progress feedback and without freezing my browser, so that I know when the tool
  is ready and am not surprised by a stall.
- As a **user on an underpowered or WebGPU-incapable device**, I want a clear, actionable
  message instead of a silent failure or a crash, so that I understand why analysis is
  unavailable and what I could do about it.
- As a **learner analyzing a line the model struggles to parse**, I want a graceful,
  readable error in the panel instead of a broken layout or a frozen extension, so that I can
  simply retry.

## Functional requirements

Requirements are grouped. Each is a testable statement of **what** Vidernu must do — not how
it is implemented. Architecture named in the brief (content script / thin background service
worker / offscreen document owning the model; `@huggingface/transformers` v3 with
`device: "webgpu"`; model `onnx-community/gemma-4-E2B-it-ONNX`) is a **constraint the plan
must honor**; the exact wiring is the planner's lane, not this spec's.

### FR-1 — Model lifecycle and readiness signaling

1. On extension install/first activation, Vidernu MUST download the model weights and persist
   them in browser storage (IndexedDB / Cache Storage) so that subsequent sessions do NOT
   re-download the model.
2. The download MUST run in the background and MUST NOT block or freeze normal browser
   interaction or YouTube playback while it proceeds.
3. The extension toolbar icon badge MUST reflect model state with at least these distinct
   states: **standby** (`STBY`), **downloading with percentage** (e.g. `DL: 45%`), **ready**
   (`READY`), and an **error** state. The percentage MUST advance as the download progresses.
4. Once the model is persisted and loaded successfully, the badge MUST show the ready state
   and analysis MUST be available.
5. If model download or load fails (network loss mid-download, storage failure, corrupt
   weights), the badge MUST show the error state and the UI MUST present an actionable message;
   the failure MUST NOT crash the extension or the YouTube page.
6. The model identity MUST be pinned to a specific model build for v1 (see NFR-privacy /
   Assumptions); the extension MUST NOT silently swap models across sessions.

### FR-2 — Device / WebGPU capability detection

7. Before attempting inference, Vidernu MUST detect WebGPU availability (`navigator.gpu`).
8. If WebGPU is unavailable, the UI MUST show a clear fallback banner (e.g. "Please enable
   WebGPU or update your GPU drivers to run Vidernu") and MUST NOT attempt to load or run the
   model. The extension MUST remain installed and non-crashing in this state.
9. If the device appears under-provisioned for the model (e.g. no discrete/adequate GPU
   signal available to the extension), the UI MUST show a visible, non-blocking warning that
   performance may be degraded, while still allowing the user to proceed. (This is a best-
   effort advisory, not a hard gate — see FR-9.)

### FR-3 — Subtitle capture

10. On YouTube watch pages, Vidernu MUST observe YouTube's native caption DOM and extract the
    text of the **single currently-active** subtitle line (the active caption window content).
11. Vidernu MUST analyze a line **only on explicit user trigger** (FR-4). It MUST NOT perform
    continuous or automatic background transcription/analysis of the whole video.
12. If captions/subtitles are not currently displayed or not available on the video, the
    trigger control MUST be disabled or clearly indicate that a visible caption line is
    required, rather than triggering analysis of empty text.
13. When the active caption spans multiple visible lines within the caption window at the
    moment of trigger, the full visible active caption text MUST be treated as the single
    "line" to analyze.

### FR-4 — Analysis trigger UX

14. Vidernu MUST provide the analysis trigger as an **always-visible "Analyze current line"
    button in the side panel**. Activating the button MUST capture whatever subtitle line is
    active in the caption DOM at the moment of the click and send it into the panel for
    analysis. (Because the trigger lives in the panel, the panel must be open to analyze; this
    is the intended v1 interaction — see Assumptions. A keyboard hotkey and/or click-on-caption
    trigger are candidate later additions and are out of scope for v1.)
15. The line captured for analysis MUST be the caption active **at the moment the button is
    clicked**; the panel MUST display which line text was analyzed so the result is
    unambiguous even after the video advances.
16. Triggering analysis MUST NOT alter video playback state in v1 (no forced pause/seek) —
    see Assumptions (accepted default; may be revisited).
17. If a new analysis is triggered while a prior analysis is still in progress, the latest
    trigger MUST win: the in-flight analysis is superseded/cancelled and the panel reflects
    the most recently requested line (no interleaved or stale results).

### FR-5 — Side-panel "split view" UI

18. Vidernu MUST render its UI as a **side panel that resizes YouTube's native content
    wrapper** (a split view), NOT as an overlay floating over the video. The video MUST remain
    fully visible and usable while the panel is open.
19. The panel MUST present the analysis of a single line in **four distinct sections**. All
    explanatory text produced by these sections (the translation, per-token roles/meanings,
    context notes, and grammar rules) MUST be rendered **in English**, regardless of the
    source caption language (see FR-8):
    a. **Translation** — the original (source-language) sentence plus its English translation,
       explicitly distinguishing a **literal** English rendering from a **natural/idiomatic**
       English one. The original source-language sentence is shown verbatim; the two
       translations are in English.
    b. **Deconstruction** — a row-by-row token breakdown that splits complex verbs from their
       suffixes, identifies grammatical particles, and shows root, part-of-speech, and
       role/meaning per token. The token/root are shown in the source language; the
       part-of-speech and role/meaning are described in English.
    c. **Context & Meaning** — tone, formality/honorifics, and colloquialisms present in the
       line, explained in English.
    d. **Grammar Notes** — textbook-style rule references (in English) for the grammatical
       structures used in the line.
20. While an analysis is in progress, the panel MUST show a clear in-progress/loading
    indication for the requested line.
21. The panel MUST render partial-but-valid results gracefully: if a section's data is empty
    or missing from a valid response, that section MUST degrade cleanly (e.g. show "not
    available") rather than break the layout.

### FR-6 — Inference contract (structured output)

22. Inference MUST be performed on-device via the WebGPU-backed local model; no request,
    subtitle text, or derived data may be sent to any external server or third-party API
    (see FR-10).
23. The model MUST be prompted to return **only** a single JSON object — no markdown code
    fences, no surrounding prose — conforming to this fixed v1 schema. All natural-language
    string values in the object (except the source-language `token`/`root` fields) MUST be
    in English (see FR-8):

    ```
    {
      "translation":   { "literal": string, "natural": string },
      "deconstruction": [ { "token": string, "root": string,
                            "part_of_speech": string, "role_or_meaning": string } ],
      "context":        string,
      "grammar_rules":  string[]
    }
    ```

24. Inference MUST use low-temperature decoding (~0.1) to favor deterministic, well-formed
    structured output. (transformers.js v3 has no grammar/JSON-schema-constrained decoding;
    structure is achieved via strict system prompting + low temperature + the repair pass in
    FR-7. This is a known constraint, not a defect to design around.)
25. Each analysis MUST be a **single-turn, stateless** inference over one subtitle line. The
    system MUST NOT accumulate conversational history or grow a KV-cache across successive
    line analyses (see FR-9).

### FR-7 — Output sanitization, repair, and error fallback

26. Raw model output MUST pass through a sanitization/repair step before parsing: stripping
    code fences and leading/trailing non-JSON junk and attempting to repair near-valid JSON.
27. If, after sanitization/repair, the output still cannot be parsed into the FR-6 schema, the
    system MUST surface a well-formed error object to the UI rather than crashing or breaking
    the panel layout:
    `{ "error": true, "message": "Local structural generation timed out or failed validation. Please retry parsing this line." }`
28. The panel MUST render this error object as a readable, retryable state (the user can
    trigger analysis of the same line again) — never as a raw stack trace, a blank panel, or a
    broken layout.
29. An analysis attempt MUST be bounded by a timeout; exceeding it MUST resolve to the same
    FR-27 error state rather than hanging indefinitely.

### FR-8 — Language scope

30. Vidernu's v1 language scope is **settled** as follows:
    a. **Source (caption) language — language-agnostic, keyed to the active caption track.**
       Vidernu MUST use language-agnostic prompting keyed to the language of the active YouTube
       caption track; it MUST NOT hard-restrict analysis to a single fixed source language.
    b. **Primary validation targets — Korean and Japanese.** These two languages (chosen for
       their honorifics/particle emphasis) are the primary targets against which the four-section
       breakdown and JSON contract MUST be validated for v1.
    c. **Output/explanation language — English (fixed).** All explanatory output across all four
       side-panel sections (FR-5) — both translations, per-token part-of-speech and
       role/meaning, context notes, and grammar rules — MUST be rendered in **English**,
       regardless of the source caption language. English is fixed for v1; it is not
       user-configurable.
31. The four-section breakdown (FR-5) and the JSON contract (FR-6) MUST be produced for the
    primary validated languages (Korean, Japanese). For other/untested source languages,
    Vidernu MUST attempt **best-effort** analysis (still English output, still the FR-6 schema)
    rather than refusing outright; when a source language is outside the validated set, the
    panel SHOULD surface a non-blocking "not fully validated for this language" note so results
    are not mistaken for validated quality. Best-effort output that cannot be parsed falls
    through to the FR-7 error path like any other unparseable result.

### FR-9 — Memory / footprint design levers (soft target)

32. Vidernu MUST apply practical levers to keep total footprint in the ballpark of the
    ~1.5 GB soft design target: a small/bounded context window, per-line single-turn stateless
    inference, and no persistent chat history or unbounded KV-cache growth across requests.
33. Vidernu MUST NOT claim or implement a fake hard OS-level memory cap enforced from
    JavaScript. The ~1.5 GB figure is a design target, and the only user-facing guardrail is
    the advisory warning in FR-9/FR-2.9 for under-provisioned devices.

### FR-10 — Privacy and local-only guarantee

34. Vidernu MUST operate with **no server, no API key, and no account**. All model download
    traffic is limited to fetching the pinned model weights from their hosting origin; **no
    subtitle text, analysis input, or analysis output may be transmitted off-device** to any
    server or third party at any time.
35. The extension MUST request only the host/permissions necessary to run on YouTube watch
    pages, capture captions, render the panel, and download/persist the model. It MUST NOT
    include analytics or telemetry that transmits user content off-device in v1.

## Out of scope (v1)

- Multi-language localization of the extension's own UI chrome.
- User-configurable output/explanation language — output is **fixed to English** in v1 (FR-8).
- Trigger mechanisms other than the in-panel "Analyze current line" button (e.g. click-on-live-
  caption, keyboard hotkey) — candidate later additions, not in v1 (FR-4).
- Any server/cloud fallback inference path — Vidernu is local-only by design.
- Persisting analysis history across sessions (accepted default: **no persistence in v1**).
- YouTube surfaces other than standard watch pages (e.g. Shorts, embedded players, live
  streams) — accepted default: **watch pages only** in v1.
- Browsers other than Chrome / Chromium-based desktop browsers that support MV3 offscreen
  documents and WebGPU (accepted default).
- Batch/whole-video analysis, export, flashcard generation, or spaced-repetition features.

## Edge cases

- **No WebGPU.** `navigator.gpu` absent → fallback banner (FR-8), no model load, no crash.
- **WebGPU present but weak/no discrete GPU.** Advisory performance warning, still usable.
- **Model download interrupted** (network drop, tab/browser closed mid-download). Badge shows
  error/standby; on next activation the download resumes or restarts without duplicating
  persisted weights or corrupting storage.
- **Storage quota exceeded / eviction.** Persisted model evicted by the browser → detected on
  next load, re-download triggered, badge reflects state; no crash.
- **Captions off or unavailable.** "Analyze current line" button disabled / clear "turn on
  captions" indication (FR-12).
- **Panel closed.** With the panel closed there is no visible trigger; opening the panel is the
  path to analysis (accepted v1 interaction — FR-4).
- **Caption changes between trigger and completion.** Result is labeled with the analyzed
  line text; the panel shows what was analyzed, not whatever is now on screen (FR-15).
- **Rapid repeated triggers.** Latest-wins supersession; no stale/interleaved results (FR-17).
- **Empty or whitespace-only active caption** (e.g. `[music]`, blank cue). Treated as no
  analyzable line; the button no-ops or shows a gentle "no text to analyze" message.
- **Non-linguistic caption content** (sound-effect tags like `[applause]`). Best-effort; must
  not crash — may return an empty/degraded but valid structure or the error fallback.
- **Untested / non-Korean-non-Japanese source language.** Best-effort English analysis via the
  FR-6 schema, with a non-blocking "not fully validated for this language" note (FR-8.31);
  unparseable output falls through to the FR-27 error path.
- **Malformed model output** (fences, trailing prose, truncated JSON). Sanitized/repaired;
  unrecoverable → FR-27 error object, retryable.
- **Inference timeout / very long line.** Bounded timeout → FR-27 error state (FR-29).
- **YouTube DOM/markup change** breaking caption capture. Capture failure must degrade to a
  clear "couldn't read the current caption" state, not a silent hang. (Fragility of depending
  on YouTube's private DOM is an accepted risk — see Assumptions.)
- **Panel open across YouTube SPA navigations** (next video, back button). Panel state and
  capture must re-bind to the new watch page or cleanly reset; no zombie observers.
- **Very small viewport.** Split view must remain usable or degrade gracefully at narrow
  widths (see NFR-accessibility).

## Acceptance criteria

Binary and testable, in Given/When/Then form.

**Model lifecycle & badge (FR-1)**
- **Given** a fresh install on a WebGPU-capable device, **when** the extension first
  activates, **then** the badge progresses through a downloading state showing an advancing
  percentage and finally shows the ready state, without freezing the browser or YouTube.
- **Given** the model has been downloaded once and persisted, **when** the browser is
  restarted and the extension re-activated, **then** the model is NOT re-downloaded and the
  badge reaches the ready state using the persisted weights.
- **Given** an in-progress model download, **when** the network connection drops, **then** the
  badge shows the error/standby state and the UI shows an actionable message, and the
  extension does not crash.

**Capability detection (FR-2)**
- **Given** a browser where `navigator.gpu` is unavailable, **when** the user opens the panel,
  **then** a fallback banner instructing them to enable WebGPU / update drivers is shown and no
  model load is attempted.
- **Given** a WebGPU-capable but low-powered device, **when** the panel opens, **then** a
  non-blocking performance-advisory warning is shown and analysis remains available.

**Capture & trigger (FR-3, FR-4)**
- **Given** a watch page with captions displayed and the panel open, **when** the user clicks
  the "Analyze current line" button, **then** exactly the currently-active caption line text is
  captured and shown as the analyzed line in the panel.
- **Given** a watch page with captions turned off/unavailable, **when** the user looks at the
  "Analyze current line" button, **then** it is disabled or clearly indicates captions are
  required, and clicking it does not start analysis of empty text.
- **Given** an analysis already in progress, **when** the user clicks "Analyze current line"
  again for a newer line, **then** the panel ends up showing the result for the newest requested
  line only, with no stale/interleaved output.
- **Given** any completed analysis, **when** the video has since advanced to a different
  caption, **then** the panel still clearly shows which line text the displayed result is for.

**Panel UI & language (FR-5, FR-8)**
- **Given** a successful analysis, **when** the panel renders, **then** all four sections
  (Translation with literal vs. natural, Deconstruction token rows, Context & Meaning, Grammar
  Notes) are present and populated from the response.
- **Given** a successful analysis of a Korean or Japanese caption line, **when** the panel
  renders, **then** the original source-language sentence is shown verbatim while both
  translations, the per-token part-of-speech and role/meaning, the context notes, and the
  grammar rules are all rendered in **English**.
- **Given** a caption whose source language is outside the validated set (not Korean/Japanese),
  **when** the user analyzes it, **then** Vidernu attempts best-effort English analysis in the
  FR-6 schema and the panel surfaces a non-blocking "not fully validated for this language"
  note (or falls through to the FR-27 error state if the output is unparseable).
- **Given** the panel is open, **when** analysis is rendered, **then** the YouTube video
  remains fully visible in a resized split view and is not covered by an overlay.
- **Given** a valid response with an empty section (e.g. no grammar rules), **when** rendered,
  **then** that section degrades cleanly (e.g. "not available") and the layout is intact.

**Inference contract & repair (FR-6, FR-7)**
- **Given** a triggered line, **when** inference runs, **then** it executes on-device via
  WebGPU and no network request carrying the subtitle text or analysis is made to any server.
- **Given** raw model output wrapped in markdown code fences or with trailing prose, **when**
  it is processed, **then** sanitization/repair extracts and parses the JSON and the panel
  renders the four sections.
- **Given** model output that cannot be parsed even after repair, **when** it is processed,
  **then** the panel shows the exact FR-27 error object as a readable, retryable message and
  the layout does not break.
- **Given** an inference that exceeds the timeout, **when** the timeout elapses, **then** the
  panel resolves to the same retryable error state rather than hanging.

**Privacy (FR-10)**
- **Given** any analysis session, **when** all network activity is inspected, **then** the only
  outbound traffic attributable to Vidernu is the one-time fetch of the pinned model weights;
  no subtitle text, analysis input, or output is transmitted off-device.
- **Given** the extension manifest, **when** its permissions are reviewed, **then** they are
  limited to what is required to run on YouTube watch pages, capture captions, render the
  panel, and download/persist the model, with no content-transmitting telemetry.

**Footprint levers (FR-9)**
- **Given** a sequence of many single-line analyses in one session, **when** the extension's
  memory behavior is observed, **then** no per-request chat history or KV-cache growth
  accumulates across analyses (each analysis is single-turn and stateless).

## Non-functional requirements

- **Privacy (overriding).** Local-only inference; no server, API key, or account; no
  off-device transmission of user content; minimal permissions; no content telemetry. This is
  the product's core promise and takes precedence in any trade-off.
- **Cost.** Zero recurring cost to the user; no paid dependency at runtime.
- **Performance / responsiveness.** Model download must not block browser interaction or
  playback (FR-2). Triggering analysis must give immediate in-progress feedback (FR-20).
  A per-analysis timeout bounds worst-case latency (FR-29). Actual token-generation latency
  depends on device GPU and is not guaranteed to a fixed number in v1, but the UI must never
  appear frozen.
- **Footprint.** ~1.5 GB total is a **soft design target** pursued via the FR-9 levers, not a
  hard-enforced cap.
- **Reliability / graceful degradation.** Every failure mode in Edge cases resolves to a clear
  UI state, never a crash, hang, or broken layout.
- **Compatibility.** Targets MV3 Chrome/Chromium desktop with WebGPU and offscreen-document
  support; behavior on unsupported browsers is a clear "unsupported/enable WebGPU" state.
- **Accessibility.** Panel content must be readable (sufficient contrast, resizable text) and
  operable at reasonable viewport widths; the split view must not render the video unusable.
- **Resilience to YouTube changes.** Caption capture depends on YouTube's private DOM;
  capture failure must degrade to a clear message (accepted fragility risk — see Assumptions).
- **Observability (local only).** Errors surface to the user in-panel and via badge state; any
  diagnostic logging stays on-device (console) and transmits nothing.

## Assumptions & open questions

**No open questions remain.** Both prior NEEDS DECISION items (FR-8 language scope & output
language; FR-4 analysis trigger mechanism) were reviewed by the product owner and resolved with
the recommended defaults — now written into the requirements above as settled behavior. The
remaining items below are accepted sensible defaults (reversible, non-foreclosing) recorded so
the pipeline can proceed. This spec is **Ratified**.

**Resolved decisions (formerly NEEDS DECISION — now settled requirements):**
- `[DECISION | owner-approved 2026-07-03]` **Language scope & output language (FR-8).**
  Language-agnostic prompting keyed to the active YouTube caption track's language; Korean and
  Japanese are the primary validation targets; **English** is the fixed explanation/output
  language for all four side-panel sections regardless of source caption language (not
  user-configurable in v1). Untested source languages get best-effort English output in the
  FR-6 schema with a "not fully validated for this language" note.
- `[DECISION | owner-approved 2026-07-03]` **Analysis trigger mechanism (FR-4).** An
  always-visible **"Analyze current line" button in the side panel**, which captures whatever
  subtitle line is active in the caption DOM at the moment of the click. Consequence (accepted):
  the panel must be open to trigger analysis. Keyboard hotkey and click-on-caption triggers are
  deferred to a later version without rework.

**Accepted defaults (recorded decisions):**
- `[ASSUMPTION | MEDIUM]` **Model pinned to `onnx-community/gemma-4-E2B-it-ONNX`** (Gemma 4,
  E2B, INT4 ONNX) via `@huggingface/transformers` v3 `device: "webgpu"`, as confirmed in the
  brief. Model weights fetched once from their Hugging Face hosting origin (the one permitted
  off-device fetch); pinned build for v1 (FR-1.6, FR-10).
- `[ASSUMPTION | MEDIUM]` **No analysis-history persistence in v1** — results are ephemeral to
  the panel/session (Out of scope). Revisit if trivial later.
- `[ASSUMPTION | MEDIUM]` **On unrecoverable parse failure, surface the FR-27 error directly**
  (user manually retries). One automatic silent retry before showing the error is a candidate
  refinement but NOT assumed for v1 unless the user wants it. → minor; flag if the user cares.
- `[ASSUMPTION | LOW]` **Triggering analysis does not pause/seek the video** (FR-16). Auto-pause
  on analyze is a plausible UX improvement but is deferred to avoid fighting user intent.
- `[ASSUMPTION | LOW]` **Watch pages only; Chrome/Chromium desktop only** for v1 (Out of scope).
- `[ASSUMPTION | LOW]` **Model download starts automatically on install** (no pre-download
  prompt / metered-connection gate in v1); progress shown via badge. A "download now?" prompt
  is a possible later refinement.
- `[ASSUMPTION | LOW]` **The whole visible active caption window text is the unit of analysis**
  (FR-13), including multi-line cues; the "Analyze current line" button captures this whole
  active window as one line (FR-4 + FR-13 compose without conflict).
- `[ASSUMPTION | LOW]` **The "not fully validated for this language" note** for out-of-scope
  source languages (FR-8.31) is a small non-blocking panel affordance; exact copy/placement is
  the implementer's lane.
- `[ASSUMPTION | LOW]` **Panel open/closed state need not persist** across sessions in v1.
- `[ASSUMPTION | LOW]` **Under-provisioned-device detection is best-effort advisory only**
  (FR-9.9); there is no reliable JS API for exact VRAM, so the warning is heuristic.
- `[ASSUMPTION | LOW]` **A concrete inference timeout value** (FR-29) will be chosen by the
  planner/implementer as a sensible bound (order of tens of seconds), tunable later.
