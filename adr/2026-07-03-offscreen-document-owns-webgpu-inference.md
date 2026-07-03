---
title: Offscreen document owns WebGPU model inference; service worker is a thin relay
date: 2026-07-03
status: Accepted
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
- a **content script** that observes/extracts YouTube's caption DOM and hosts the injected
  panel (see adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md);
- a **panel UI module** (`src/sidepanel/`) that renders the four-section breakdown and hosts
  the "Analyze current line" trigger, mounted by the content script into a shadow root it
  injects into the YouTube page.
  All cross-surface communication uses a single typed `chrome.runtime` message union
  (`src/shared/messages.ts`).

## Alternatives considered

- **Run inference directly in the service worker** — rejected: no WebGPU in a service
  worker, and its aggressive termination would kill in-flight generation and force reloads
  of the model.
- **Run inference inside the content script (in the YouTube page)** — rejected: pollutes the
  page's memory with a multi-GB model, is exposed to YouTube's CSP/global mutations, and
  couples model lifetime to page navigations.
- **Run inference in a separate `chrome.sidePanel` page** — rejected: model state would die
  every time the user closes the panel; the panel should stay a lightweight, disposable UI.
  (This alternative is now moot in this codebase since the panel itself is not a
  `chrome.sidePanel` page at all — see the companion ADR — but the reasoning against housing
  the model in *any* disposable UI surface still holds.)

## Consequences

- Clean separation: WebGPU/model lives where WebGPU and a persistent DOM exist; the service
  worker stays cheap and restart-tolerant; the panel is disposable.
- Cost: an explicit typed message-relay layer and an offscreen-lifecycle manager must be
  built and kept in sync; `chrome.offscreen.createDocument` requires a `reason`
  (`WORKERS`, justified as running WebGPU compute off the worker thread) and the
  `offscreen` permission.
- Latest-wins cancellation across surfaces is cooperative (stale results discarded by
  `requestId`, plus a polled `InterruptableStoppingCriteria`) because a WebGPU generation
  cannot be hard-aborted mid-kernel.
- Because caption capture and the panel both live in the content script's execution context
  (see the companion ADR), the message contract does not need a `CAPTURE_CAPTION` round trip
  between the panel and the content script — only the offscreen document is a genuinely
  separate process boundary requiring `chrome.runtime` messaging for the model lifecycle and
  inference.
