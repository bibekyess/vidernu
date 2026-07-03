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
    refreshButtonState();
  }

  const onMessage = (message: unknown): void => {
    if (isStateSnapshot(message)) {
      applyState(message);
      return;
    }
    if (isModelStatusMsg(message)) {
      applyState({
        modelStatus: message.status,
        progress: message.progress,
        webgpu: webgpuAvailable,
      });
      return;
    }
    if (isCapabilityMsg(message)) {
      applyState({
        modelStatus,
        webgpu: message.webgpu,
        lowPowerHint: message.lowPowerHint,
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
