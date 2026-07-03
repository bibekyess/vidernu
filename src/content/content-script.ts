/**
 * Content script: owns the YouTube caption DOM and hosts the injected panel
 * (see adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md).
 * No inference/model code lives here — only DOM concerns.
 */
import { isTogglePanel } from "../shared/messages";
import { type CaptureAttempt, mountPanel, type PanelHandle } from "../sidepanel/main";
import { extractActiveCaption } from "./caption-extractor";
import { injectPanel, removePanel } from "./panel-injector";

let panelHandle: PanelHandle | null = null;
let captionObserver: MutationObserver | null = null;

/** Never throws: a caption-DOM read failure degrades to a clear error state (FR edge case). */
function safeCapture(): CaptureAttempt {
  try {
    return extractActiveCaption(document);
  } catch (err) {
    console.warn("[Vidernu] Failed to read the caption DOM:", err);
    return { present: false, text: "", readError: true };
  }
}

function isWatchPage(): boolean {
  return location.pathname === "/watch";
}

function startCaptionObserver(): void {
  if (captionObserver) return;
  captionObserver = new MutationObserver(() => {
    // Presence indicator only (FR-3.12) — never triggers analysis (FR-3.11).
    panelHandle?.updateCaptionHint(safeCapture().present);
  });
  captionObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function stopCaptionObserver(): void {
  captionObserver?.disconnect();
  captionObserver = null;
}

function openPanel(): void {
  if (panelHandle) return;
  const injected = injectPanel(document);
  if (!injected) {
    console.warn("[Vidernu] Could not attach panel: YouTube's #columns container was not found.");
    return;
  }
  panelHandle = mountPanel(injected.shadow, injected.container, safeCapture);
  startCaptionObserver();
}

function closePanel(): void {
  if (!panelHandle) return;
  panelHandle.destroy();
  panelHandle = null;
  removePanel(document);
  stopCaptionObserver();
}

function togglePanel(): void {
  if (panelHandle) closePanel();
  else openPanel();
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isTogglePanel(message)) togglePanel();
});

// YouTube's SPA router dispatches this event on navigation between videos
// without a full page reload; re-bind (or cleanly close) rather than leaving
// zombie observers / a panel attached to a detached #columns (edge case).
document.addEventListener("yt-navigate-finish", () => {
  const wasOpen = panelHandle !== null;
  if (wasOpen) closePanel();
  if (wasOpen && isWatchPage()) openPanel();
});
