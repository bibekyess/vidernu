---
title: Render Vidernu's panel by injecting into YouTube's page DOM, not via chrome.sidePanel
date: 2026-07-03
status: Accepted
supersedes:
superseded-by:
---

# 2026-07-03 — Render Vidernu's panel by injecting into YouTube's page DOM, not via chrome.sidePanel

## Context

FR-5.18 requires Vidernu's UI to be "a side panel that resizes YouTube's native content
wrapper" — an in-page split view where the video remains fully visible and usable, not an
overlay floating over it. The technical plan's first draft proposed the native
`chrome.sidePanel` browser API on the theory that Chrome shrinking the *browser's* content
area would cause YouTube's responsive layout to reflow enough to satisfy this requirement.
On review, `chrome.sidePanel` does not manipulate the page's own DOM at all — it resizes the
browser viewport available to the tab, which YouTube's fixed/flex layout does not reliably
respond to the way the acceptance criterion requires ("the YouTube video remains fully
visible in a resized split view", verified against YouTube's actual `#columns` layout, not
just a smaller viewport). This is a settled product-owner decision (see the spec's
Assumptions and the accompanying task instructions): the panel must be implemented as an
in-page injected sidebar that directly resizes YouTube's own `#columns` container.

## Decision

We will render Vidernu's panel by having the **content script** inject a host element as a
flex sibling of YouTube's `#columns` container and shrink `#columns` to share the row with
it (`src/content/panel-injector.ts`), rather than using the native `chrome.sidePanel` API.
The host element attaches an **open shadow root** so Vidernu's styles never leak onto (or are
overridden by) YouTube's page CSS. The panel UI itself (`src/sidepanel/main.ts`,
`render.ts`) is mounted into that shadow root by the content script; there is no separate
`chrome.sidePanel` page, no `sidePanel` manifest key, and no `sidePanel` permission.
The manifest instead exposes a plain `action` (toolbar icon); clicking it sends a
`TOGGLE_PANEL` message to the active YouTube tab's content script, which injects or removes
the panel.

## Alternatives considered

- **`chrome.sidePanel` (the plan's original proposal)** — rejected per the product owner's
  explicit direction: it resizes the browser's viewport, not YouTube's own `#columns`
  wrapper, so it does not reliably satisfy FR-5.18's specific acceptance criterion, and it
  would require a second, disconnected code path (a real extension page) purely for
  cosmetic parity with the in-page video, which the DOM-injection approach makes unnecessary.
- **An overlay floating over the video** — explicitly rejected by FR-5.18 itself: the
  requirement is a split view, not an overlay.
- **A content-script-injected `<iframe>` hosting a separate extension page** — considered for
  extra isolation, but rejected as unnecessary complexity: a shadow root inside the same
  content-script document gives equivalent style isolation without the messaging/lifecycle
  overhead of an iframe boundary, and keeps the panel able to call `extractActiveCaption`
  synchronously (see Consequences).

## Consequences

- Vidernu now directly manipulates a specific, unstable, YouTube-private selector
  (`#columns`) to inject and resize the panel. This is an explicit instance of the accepted
  "resilience to YouTube changes" risk already named in the spec's NFRs: if YouTube renames
  or restructures `#columns`, `injectPanel()` degrades to returning `null` (logged, no
  crash) rather than corrupting the page layout.
- Because the panel is mounted directly in the content script's document (not a separate
  extension page), caption capture never crosses a `chrome.runtime` message boundary: the
  content script calls `extractActiveCaption(document)` synchronously when the "Analyze
  current line" button is clicked, rather than the panel asking the service worker to ask the
  content script for a `CAPTURE_CAPTION` round trip. This simplifies the message contract
  (see the companion offscreen-document ADR) at the cost of coupling the panel module to
  being instantiated by the content script rather than being independently addressable.
- The `sidePanel` permission and manifest key are dropped entirely, narrowing the extension's
  permission surface (FR-10.35).
- Vidernu must manage its own open/close affordance (the toolbar action + `TOGGLE_PANEL`)
  instead of relying on Chrome's built-in side-panel open/close chrome; this is a small
  amount of extra lifecycle code (`panel-injector.ts`) that must also re-bind or cleanly tear
  down across YouTube's SPA navigations (handled via the `yt-navigate-finish` event in
  `content-script.ts`) so no zombie observers or detached panel hosts are left behind.
