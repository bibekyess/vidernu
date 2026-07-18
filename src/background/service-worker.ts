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
  isStopAnalysis,
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
  // Single-line error detail forwarded from the offscreen MODEL_STATUS error
  // payload; undefined on any non-error status (FR-3/FR-5).
  message?: string;
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

  // Set the badge immediately so it reflects the current/standby state before
  // any MODEL_STATUS arrives — never leaves the badge empty (FR-15/FR-16/FR-19).
  setBadge(currentState.modelStatus, currentState.progress);

  await ensureOffscreenDocument();

  // Send LOAD_MODEL regardless of the persisted status. On a SW-only idle-restart
  // the offscreen doc and its in-memory pipeline survive (chrome.storage.session
  // persists across SW idle-restarts and the offscreen document has an independent
  // lifecycle — see spec FR-20 and the PR description for the verification note).
  // loadModel() is idempotent: it returns the live singleton when the pipeline
  // already exists, so a surviving "ready" state is preserved and no re-download
  // occurs; the re-posted MODEL_STATUS "ready" reconciles currentState. On a full
  // extension reload (session cleared, offscreen torn down) this starts cold (FR-19).
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
      // Lazy re-init: if the model is not ready when analysis is requested,
      // trigger a (re-)load so the user gets progress rather than being left
      // stranded at a stale non-ready status (FR-21). Both phases and any
      // retry flow through this one branch, so they all inherit this.
      if (currentState.modelStatus !== "ready") {
        chrome.runtime.sendMessage({ type: "LOAD_MODEL" } satisfies Message).catch(() => {});
      }
      chrome.runtime
        .sendMessage({
          type: "RUN_INFERENCE",
          requestId: message.requestId,
          phase: message.phase,
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

  if (isStopAnalysis(message)) {
    // Relay as a user-initiated cancel (FR-C, see
    // adr/2026-07-04-user-initiated-cooperative-stop.md). Eagerly drop the
    // pending entry — the offscreen document's superseded INFERENCE_RESULT
    // would also clean it up, but there is no reason to wait for that race.
    pendingAnalyses.delete(message.requestId);
    chrome.runtime
      .sendMessage({ type: "STOP_INFERENCE", requestId: message.requestId } satisfies Message)
      .catch(() => {
        // No offscreen listener (e.g. it was never created) — nothing was
        // running to stop; not an error worth surfacing.
      });
    return false;
  }

  if (isModelStatusMsg(message)) {
    currentState = {
      ...currentState,
      modelStatus: message.status,
      progress: message.progress,
      // Store the error detail on error and clear it on any non-error status (FR-3/FR-5).
      message: message.status === "error" ? message.message : undefined,
    };
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
      phase: message.phase,
      analyzedLine: pending.analyzedLine,
      result: message.result,
    });
    return false;
  }

  return false;
});
