/**
 * Thin background service worker (see ADR): lifecycle, badge, and message
 * relay only — no inference/model code lives here. Fully restart-tolerant:
 * all durable state is either in the offscreen document (the model) or
 * mirrored into `chrome.storage.session`.
 */
import {
  isAnalyzeRequest,
  isCapabilityMsg,
  isGetState,
  isInferenceResult,
  isModelStatusMsg,
  type Message,
  type ModelStatusValue,
  type StateSnapshot,
} from "../shared/messages";
import { setBadge } from "./badge";
import { ensureOffscreenDocument } from "./offscreen-manager";

const YOUTUBE_WATCH_PREFIX = "https://www.youtube.com/watch";

interface ExtensionState {
  modelStatus: ModelStatusValue;
  progress?: number;
  webgpu: boolean;
  lowPowerHint?: boolean;
}

let currentState: ExtensionState = { modelStatus: "standby", webgpu: true };

function persistState(): void {
  void chrome.storage.session.set({ state: currentState });
}

async function loadPersistedState(): Promise<void> {
  const stored = await chrome.storage.session.get("state");
  const state = stored.state as ExtensionState | undefined;
  if (state) currentState = state;
}

function isWatchTab(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number } {
  return !!tab && typeof tab.id === "number" && !!tab.url?.startsWith(YOUTUBE_WATCH_PREFIX);
}

function send(tabId: number, message: Message): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // No content script listening in that tab (navigated away / not yet
    // injected) — not an error worth surfacing.
  });
}

async function broadcastState(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: `${YOUTUBE_WATCH_PREFIX}*` });
  const message: StateSnapshot = { type: "STATE", ...currentState };
  for (const tab of tabs) {
    if (typeof tab.id === "number") send(tab.id, message);
  }
}

async function init(): Promise<void> {
  await loadPersistedState();
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: "LOAD_MODEL" } satisfies Message).catch(() => {
    // The offscreen document's listener may not be attached yet on the very
    // first tick after creation; it will pick up state from CAPABILITY/
    // MODEL_STATUS once ready regardless.
  });
}

chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());

chrome.action.onClicked.addListener((tab) => {
  if (!isWatchTab(tab)) return;
  send(tab.id, { type: "TOGGLE_PANEL" });
});

// requestId -> where an in-flight analysis came from, so its eventual
// INFERENCE_RESULT (pushed by the offscreen document, with no tab context
// of its own) can be relayed back to the right tab. Entries are removed on
// every INFERENCE_RESULT, whether it "wins" or arrives with
// `superseded: true` — otherwise a stale request's entry would never be
// cleaned up and the map would grow for the life of the service worker.
const pendingAnalyses = new Map<number, { tabId: number; analyzedLine: string }>();

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isGetState(message)) {
    sendResponse({ type: "STATE", ...currentState } satisfies StateSnapshot);
    return false;
  }

  if (isAnalyzeRequest(message)) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return false;
    pendingAnalyses.set(message.requestId, { tabId, analyzedLine: message.text });
    void (async () => {
      await ensureOffscreenDocument();
      chrome.runtime
        .sendMessage({
          type: "RUN_INFERENCE",
          requestId: message.requestId,
          text: message.text,
          lang: message.lang,
        } satisfies Message)
        .catch(() => {
          // Handled by the offscreen document once it comes up; if it never
          // does, this request simply never resolves — the panel's own
          // timeout expectation is bounded by the offscreen-side FR-29 timer.
        });
    })();
    return false;
  }

  if (isModelStatusMsg(message)) {
    currentState = { ...currentState, modelStatus: message.status, progress: message.progress };
    persistState();
    setBadge(message.status, message.progress);
    void broadcastState();
    return false;
  }

  if (isCapabilityMsg(message)) {
    currentState = { ...currentState, webgpu: message.webgpu, lowPowerHint: message.lowPowerHint };
    persistState();
    void broadcastState();
    return false;
  }

  if (isInferenceResult(message)) {
    const pending = pendingAnalyses.get(message.requestId);
    pendingAnalyses.delete(message.requestId);
    if (!pending || message.superseded) return false;
    send(pending.tabId, {
      type: "ANALYSIS_RESULT",
      requestId: message.requestId,
      analyzedLine: pending.analyzedLine,
      result: message.result,
    });
    return false;
  }

  return false;
});
