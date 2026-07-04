/**
 * Panel bootstrap. Mounted by the content script into the shadow root it
 * creates via `panel-injector.ts` (FR-5.18). Owns the "Analyze current
 * line" button, the latest-wins request/response bookkeeping (FR-17), and
 * subscribing to pushed model/capability state.
 */
import { formatBadgeTitle, VALIDATED_LANGS } from "../shared/constants";
import {
  isAnalysisResultMsg,
  isCapabilityMsg,
  isModelStatusMsg,
  isStateSnapshot,
  type Message,
  type ModelStatusValue,
} from "../shared/messages";
import { isAnalysisError } from "../shared/schema";
import cssText from "./sidepanel.css?inline";
import {
  type PanelElements,
  renderAnalysis,
  renderAnalysisError,
  renderCaptureError,
  renderLoading,
  renderNoCaption,
  renderSkeleton,
  setAdvisoryBanner,
  setAnalyzeButtonState,
  setCaptionHint,
  setFallbackBanner,
  setLoadError,
  setModelState,
  setValidationNote,
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

  let latestRequestId = 0;
  let pendingLang: string | undefined;
  let webgpuAvailable = true;
  let modelStatus: ModelStatusValue = "standby";

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

  function applyState(state: {
    modelStatus: ModelStatusValue;
    progress?: number;
    webgpu: boolean;
    lowPowerHint?: boolean;
    message?: string;
    // When true, skip updating the load-error area so a capability-only update
    // does not wipe the visible error detail while the status is still "error".
    preserveLoadError?: boolean;
  }): void {
    webgpuAvailable = state.webgpu;
    modelStatus = state.modelStatus;

    setFallbackBanner(
      els,
      state.webgpu ? null : "Please enable WebGPU or update your GPU drivers to run Vidernu.",
    );
    setAdvisoryBanner(
      els,
      state.webgpu && state.lowPowerHint
        ? "Your device's GPU may be under-provisioned for this model — analysis could be slow."
        : null,
    );
    setModelState(els, describeModelState(state.modelStatus, state.progress));

    // Render the dedicated load-error area on error, clear it on any other status (FR-4/FR-5).
    // Skip when the caller signals that the load-error should be left untouched (e.g. a
    // capability-only update that carries no new status and no new error detail).
    if (!state.preserveLoadError) {
      if (state.modelStatus === "error") {
        setLoadError(els, state.message ?? "");
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
      if (message.requestId !== latestRequestId) return; // stale — latest-wins (FR-17)
      if (isAnalysisError(message.result)) {
        renderAnalysisError(els, message.analyzedLine, message.result.message);
        return;
      }
      renderAnalysis(els, message.analyzedLine, message.result);
      setValidationNote(
        els,
        isValidatedLang(pendingLang)
          ? null
          : "This source language isn't fully validated yet (Vidernu's primary targets are " +
              "Korean and Japanese) — treat this best-effort result with extra care.",
      );
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
    const requestId = ++requestCounter;
    latestRequestId = requestId;

    const capture = captureCaption();
    if (capture.readError) {
      renderCaptureError(els);
      return;
    }
    if (!capture.present) {
      renderNoCaption(els);
      return;
    }

    pendingLang = capture.lang;
    setValidationNote(els, null);
    renderLoading(els, capture.text);
    chrome.runtime.sendMessage({
      type: "ANALYZE_REQUEST",
      requestId,
      text: capture.text,
      lang: capture.lang,
    } satisfies Message);
  });

  return {
    updateCaptionHint(present: boolean): void {
      setCaptionHint(els, present);
    },
    destroy(): void {
      chrome.runtime.onMessage.removeListener(onMessage);
    },
  };
}
