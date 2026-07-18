/**
 * Panel bootstrap. Mounted by the content script into the shadow root it
 * creates via `panel-injector.ts` (FR-5.18). Owns the two-phase analysis
 * flow (FR-A), Stop (FR-C), per-phase Retry (FR-D), and subscribing to
 * pushed model/capability state. The mutable `state` (see `panel-state.ts`)
 * plus the per-phase latest-request-id bookkeeping is this module's single
 * source of truth; every mutation is followed by a `render()` call.
 */
import { formatBadgeTitle, VALIDATED_LANGS } from "../shared/constants";
import {
  isAnalysisResultMsg,
  isCapabilityMsg,
  isModelStatusMsg,
  isStateSnapshot,
  type AnalysisPhase,
  type Message,
  type ModelStatusValue,
} from "../shared/messages";
import { isAnalysisError, type DetailResult, type QuickResult } from "../shared/schema";
import {
  deriveTabStates,
  detailFailed,
  detailSucceeded,
  INITIAL_PANEL_STATE,
  quickFailed,
  quickSucceeded,
  retryDetail,
  retryQuick,
  runningPhase,
  setActiveTab,
  showDetailTrigger,
  startDetail,
  startQuick,
  stopDetail,
  stopQuick,
  type PanelState,
  type TabId,
} from "./panel-state";
import cssText from "./sidepanel.css?inline";
import {
  renderCaptureError,
  renderNoCaption,
  renderPanel,
  renderSkeleton,
  setAdvisoryBanner,
  setAnalyzeButtonState,
  setCaptionHint,
  setFallbackBanner,
  setLoadError,
  setModelState,
  setValidationNote,
  type PanelElements,
} from "./render";

export interface CaptureAttempt {
  present: boolean;
  text: string;
  lang?: string;
  /** Set when the caption DOM could not be read at all (YouTube DOM-change edge case). */
  readError?: boolean;
}

export interface PanelHandle {
  /** Reflects live caption presence in the panel without triggering analysis (FR-3.11/3.12). */
  updateCaptionHint(present: boolean): void;
  destroy(): void;
}

const TAB_ORDER: readonly TabId[] = ["translation", "deconstruction", "context", "grammar"];

let requestCounter = 0;

function isValidatedLang(lang: string | undefined): boolean {
  return !!lang && (VALIDATED_LANGS as readonly string[]).includes(lang);
}

function describeModelState(status: ModelStatusValue, progress?: number): string | null {
  if (status === "ready") return null;
  return formatBadgeTitle(status, progress);
}

/**
 * Mounts the panel UI into `container` (inside `shadow`) and wires it to
 * `chrome.runtime` messaging. `captureCaption` is injected by the content
 * script so this module stays free of direct YouTube-DOM access.
 */
export function mountPanel(
  shadow: ShadowRoot,
  container: HTMLElement,
  captureCaption: () => CaptureAttempt,
): PanelHandle {
  const style = document.createElement("style");
  style.textContent = cssText;
  shadow.appendChild(style);

  const els: PanelElements = renderSkeleton(container);
  setCaptionHint(els, captureCaption().present);

  // Wire the Retry button to re-trigger LOAD_MODEL from the error state (FR-14).
  // The offscreen in-flight guard prevents duplicate loads on double-click (edge case).
  els.loadErrorRetry.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "LOAD_MODEL" } satisfies Message);
  });

  // Per-phase latest-wins request ids (FR-A8). 0 never matches a real
  // requestId (the counter starts at 1), so it is a safe "nothing pending"
  // sentinel for the phase that has not run yet.
  let latestQuickRequestId = 0;
  let latestDetailRequestId = 0;
  let state: PanelState = INITIAL_PANEL_STATE;
  // The captured line + lang both phases of the current analysis operate on
  // (FR-A4) — set once per "Analyze current line" click, reused by the
  // detail phase and by retry, never by whatever caption is on screen later.
  let currentAnalysis: { text: string; lang?: string } | null = null;

  let webgpuAvailable = true;
  let modelStatus: ModelStatusValue = "standby";

  function render(): void {
    renderPanel(els, state, {
      onRetryQuick: () => handleRetry("quick"),
      onRetryDetail: () => handleRetry("detail"),
    });
  }

  function sendAnalyze(requestId: number, phase: AnalysisPhase, text: string, lang?: string): void {
    chrome.runtime.sendMessage({
      type: "ANALYZE_REQUEST",
      requestId,
      phase,
      text,
      lang,
    } satisfies Message);
  }

  function handleRetry(phase: AnalysisPhase): void {
    if (!currentAnalysis) return;
    // Double-press guard (edge case): ignore if that phase is already in flight.
    if (phase === "quick") {
      if (state.quick.status === "loading") return;
      state = retryQuick(state);
      const id = ++requestCounter;
      latestQuickRequestId = id;
      sendAnalyze(id, "quick", currentAnalysis.text, currentAnalysis.lang);
    } else {
      if (state.detail.status === "loading") return;
      state = retryDetail(state);
      const id = ++requestCounter;
      latestDetailRequestId = id;
      sendAnalyze(id, "detail", currentAnalysis.text, currentAnalysis.lang);
    }
    render();
  }

  function refreshButtonState(): void {
    if (!webgpuAvailable) {
      setAnalyzeButtonState(els, { enabled: false, label: "WebGPU unavailable" });
      return;
    }
    if (modelStatus !== "ready") {
      setAnalyzeButtonState(els, { enabled: false, label: "Analyze current line" });
      return;
    }
    setAnalyzeButtonState(els, { enabled: true, label: "Analyze current line" });
  }

  function applyState(stateUpdate: {
    modelStatus: ModelStatusValue;
    progress?: number;
    webgpu: boolean;
    lowPowerHint?: boolean;
    message?: string;
    // When true, skip updating the load-error area so a capability-only update
    // does not wipe the visible error detail while the status is still "error".
    preserveLoadError?: boolean;
  }): void {
    webgpuAvailable = stateUpdate.webgpu;
    modelStatus = stateUpdate.modelStatus;

    setFallbackBanner(
      els,
      stateUpdate.webgpu ? null : "Please enable WebGPU or update your GPU drivers to run Vidernu.",
    );
    setAdvisoryBanner(
      els,
      stateUpdate.webgpu && stateUpdate.lowPowerHint
        ? "Your device's GPU may be under-provisioned for this model — analysis could be slow."
        : null,
    );
    setModelState(els, describeModelState(stateUpdate.modelStatus, stateUpdate.progress));

    // Render the dedicated load-error area on error, clear it on any other status (FR-4/FR-5).
    // Skip when the caller signals that the load-error should be left untouched (e.g. a
    // capability-only update that carries no new status and no new error detail).
    if (!stateUpdate.preserveLoadError) {
      if (stateUpdate.modelStatus === "error") {
        setLoadError(els, stateUpdate.message ?? "");
      } else {
        setLoadError(els, null);
      }
    }

    refreshButtonState();
  }

  const onMessage = (message: unknown): void => {
    if (isStateSnapshot(message)) {
      // StateSnapshot now carries the optional error message (Step 2 / FR-3).
      applyState(message);
      return;
    }
    if (isModelStatusMsg(message)) {
      applyState({
        modelStatus: message.status,
        progress: message.progress,
        webgpu: webgpuAvailable,
        message: message.message,
      });
      return;
    }
    if (isCapabilityMsg(message)) {
      applyState({
        modelStatus,
        webgpu: message.webgpu,
        lowPowerHint: message.lowPowerHint,
        // A capability update carries no status change and no error detail — leave the
        // load-error area exactly as-is so an existing error stays visible (P3 fix).
        preserveLoadError: true,
      });
      return;
    }
    if (isAnalysisResultMsg(message)) {
      if (message.phase === "quick") {
        if (message.requestId !== latestQuickRequestId) return; // stale (FR-A8/C5)
        if (isAnalysisError(message.result)) {
          state = quickFailed(state, message.result.message);
        } else {
          state = quickSucceeded(state, message.result as QuickResult);
          setValidationNote(
            els,
            isValidatedLang(currentAnalysis?.lang)
              ? null
              : "This source language isn't fully validated yet (Vidernu's primary targets are " +
                  "Korean and Japanese) — treat this best-effort result with extra care.",
          );
        }
        render();
        return;
      }
      if (message.phase === "detail") {
        if (message.requestId !== latestDetailRequestId) return; // stale (FR-A8/C5)
        if (isAnalysisError(message.result)) {
          state = detailFailed(state, message.result.message);
        } else {
          state = detailSucceeded(state, message.result as DetailResult);
        }
        render();
      }
    }
  };

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.runtime.sendMessage({ type: "GET_STATE" } satisfies Message, (response: unknown) => {
    // No open port on the other end (SW asleep/unreachable) is not fatal —
    // the panel simply waits for a pushed STATE/MODEL_STATUS message.
    void chrome.runtime.lastError;
    if (isStateSnapshot(response)) applyState(response);
  });

  els.analyzeButton.addEventListener("click", () => {
    const capture = captureCaption();
    if (capture.readError) {
      renderCaptureError(els);
      return;
    }
    if (!capture.present) {
      renderNoCaption(els);
      return;
    }

    currentAnalysis = { text: capture.text, lang: capture.lang };
    setValidationNote(els, null);
    state = startQuick(capture.text, capture.lang);
    const id = ++requestCounter;
    latestQuickRequestId = id;
    // A fresh analyze supersedes the whole panel (FR-A8) — invalidate any
    // prior detail request so a late detail result for the old line can
    // never render under the new one.
    latestDetailRequestId = 0;
    sendAnalyze(id, "quick", capture.text, capture.lang);
    render();
  });

  els.detailTrigger.addEventListener("click", () => {
    if (!currentAnalysis || !showDetailTrigger(state)) return;
    state = startDetail(state);
    const id = ++requestCounter;
    latestDetailRequestId = id;
    sendAnalyze(id, "detail", currentAnalysis.text, currentAnalysis.lang);
    render();
  });

  els.stopButton.addEventListener("click", () => {
    const phase = runningPhase(state);
    if (!phase) return; // no-op — nothing in flight (edge case)
    const requestId = phase === "quick" ? latestQuickRequestId : latestDetailRequestId;
    chrome.runtime.sendMessage({ type: "STOP_ANALYSIS", requestId, phase } satisfies Message);
    // The panel is authoritative over its own UI (ADR
    // 2026-07-04-user-initiated-cooperative-stop.md) — transition optimistically
    // rather than waiting for the offscreen document's acknowledgment.
    state = phase === "quick" ? stopQuick(state) : stopDetail(state);
    // Bump that phase's latest id to a never-sent sentinel so a result that
    // raced the stop is still dropped by the ANALYSIS_RESULT handler (FR-C5).
    if (phase === "quick") {
      latestQuickRequestId = ++requestCounter;
    } else {
      latestDetailRequestId = ++requestCounter;
    }
    render();
  });

  for (const tabId of TAB_ORDER) {
    els.tabs[tabId].addEventListener("click", () => {
      if (deriveTabStates(state)[tabId] === "pending") return; // locked (FR-E6)
      state = setActiveTab(state, tabId);
      render();
    });
  }

  // Paint the initial "ready to analyze" state (FR-E4). Without this call the
  // tab strip renders with no labels/aria state and the tab panel is empty
  // until the first state-changing action — `renderSkeleton` only builds the
  // bare DOM shape, it never labels/selects the tabs itself.
  render();

  return {
    updateCaptionHint(present: boolean): void {
      setCaptionHint(els, present);
    },
    destroy(): void {
      chrome.runtime.onMessage.removeListener(onMessage);
    },
  };
}
