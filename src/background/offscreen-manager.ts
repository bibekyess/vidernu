/**
 * Idempotent offscreen-document lifecycle (FR-1, see ADR). The service
 * worker never runs inference itself — it only ensures the offscreen
 * document exists before relaying model/inference messages to it.
 */

const OFFSCREEN_URL = "src/offscreen/offscreen.html";

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

// Shared in-flight creation promise so concurrent callers await the same
// `createDocument()` call rather than racing it — only one offscreen
// document is allowed, and a second concurrent `createDocument()` call
// would reject.
let creating: Promise<void> | null = null;

/** Creates the offscreen document if one doesn't already exist. */
export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Runs WebGPU-backed local model inference off the service-worker thread.",
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}
