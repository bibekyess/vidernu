/**
 * Offscreen document message handler (FR-1, FR-2, FR-6, FR-7, FR-17). Owns
 * the model lifecycle and inference; the service worker never runs
 * inference itself (see ADR).
 */
import { TIMEOUT_MS } from "../shared/constants";
import {
  type CapabilityMsg,
  isLoadModel,
  isRunInference,
  type InferenceResult,
  type ModelStatusMsg,
} from "../shared/messages";
import { type AnalysisError, type AnalysisResult, makeAnalysisError } from "../shared/schema";
import { detectWebGPU } from "./capability";
import { runInference } from "./inference";
import { loadModel } from "./model";

// The requestId currently "owned" by this offscreen document. A newer
// RUN_INFERENCE bumps this, marking any older in-flight generation
// superseded (FR-17 latest-wins).
let currentRequestId = 0;

function post(message: ModelStatusMsg | CapabilityMsg | InferenceResult): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // The service worker may not have a listener attached yet (e.g. during
    // its own startup) — non-fatal, the next push will land.
  });
}

async function handleLoadModel(): Promise<void> {
  const capability = await detectWebGPU();
  post({ type: "CAPABILITY", ...capability });

  if (!capability.webgpu) {
    post({
      type: "MODEL_STATUS",
      status: "error",
      message: "WebGPU is not available on this device.",
    });
    return;
  }

  post({ type: "MODEL_STATUS", status: "downloading", progress: 0 });
  try {
    await loadModel((progress) => {
      post({ type: "MODEL_STATUS", status: progress.status, progress: progress.progress });
    });
    post({ type: "MODEL_STATUS", status: "ready" });
  } catch (err) {
    post({
      type: "MODEL_STATUS",
      status: "error",
      message: err instanceof Error ? err.message : "The model failed to load.",
    });
  }
}

async function handleRunInference(requestId: number, text: string, lang?: string): Promise<void> {
  currentRequestId = requestId;
  let timedOut = false;
  const isSuperseded = (): boolean => currentRequestId !== requestId || timedOut;

  const result = await raceTimeout<AnalysisResult | AnalysisError>(
    runInference(text, lang, isSuperseded),
    TIMEOUT_MS,
    () => {
      timedOut = true;
      return makeAnalysisError();
    },
  );

  if (currentRequestId !== requestId) return; // a newer request has already won
  post({ type: "INFERENCE_RESULT", requestId, result });
}

/** Bounds an analysis attempt by a timeout (FR-7.29) without leaving a dangling timer. */
function raceTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(onTimeout());
      });
  });
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isLoadModel(message)) {
    void handleLoadModel();
    return;
  }
  if (isRunInference(message)) {
    void handleRunInference(message.requestId, message.text, message.lang);
  }
});
