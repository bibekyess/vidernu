/**
 * Offscreen document message handler (FR-1, FR-2, FR-6, FR-7, FR-17). Owns
 * the model lifecycle and inference; the service worker never runs
 * inference itself (see ADR).
 */
import { LOAD_STALL_TIMEOUT_MS, LOAD_TIMEOUT_MESSAGE, TIMEOUT_MS } from "../shared/constants";
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
import { deriveErrorMessage, loadModel, resetPipeline } from "./model";

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

// Stall-timer state. These three module-scoped variables are reset before
// each load attempt so vi.resetModules() between tests gives a clean slate.
let loadStallTimer: ReturnType<typeof setTimeout> | null = null;
// Prevents a double terminal post if the timeout fires at the same instant
// the load resolves or rejects (FR-11: ready cancels timer; race guard).
let loadTerminal = false;
// Prevents re-arming the timer or double-posting "downloading 0" when a
// second LOAD_MODEL arrives while a load is already in flight (edge case).
let loadInFlight = false;

function clearStallTimer(): void {
  if (loadStallTimer !== null) {
    clearTimeout(loadStallTimer);
    loadStallTimer = null;
  }
}

function onStallTimeout(): void {
  if (loadTerminal) return; // ready or catch already won the race
  loadTerminal = true;
  loadInFlight = false;
  console.error("Vidernu model load stalled (no progress within timeout)");
  post({ type: "MODEL_STATUS", status: "error", message: LOAD_TIMEOUT_MESSAGE });
  // Clear the singleton so the next LOAD_MODEL retries from scratch (FR-13).
  resetPipeline();
}

function armStallTimer(): void {
  clearStallTimer();
  loadStallTimer = setTimeout(onStallTimeout, LOAD_STALL_TIMEOUT_MS);
}

// Reset on every progress update so a live download keeps the timer at bay (FR-12).
function resetStallTimer(): void {
  armStallTimer();
}

async function handleLoadModel(): Promise<void> {
  // Guard against double LOAD_MODEL: reuse the in-flight load rather than
  // spawning a duplicate and re-arming the timer (edge case: retry racing restart).
  if (loadInFlight) return;

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

  loadInFlight = true;
  loadTerminal = false;
  armStallTimer();

  post({ type: "MODEL_STATUS", status: "downloading", progress: 0 });
  try {
    await loadModel((progress) => {
      resetStallTimer();
      post({ type: "MODEL_STATUS", status: progress.status, progress: progress.progress });
    });

    if (loadTerminal) return; // timeout already won the race
    loadTerminal = true;
    loadInFlight = false;
    clearStallTimer();
    post({ type: "MODEL_STATUS", status: "ready" });
  } catch (err) {
    if (loadTerminal) return; // timeout already won the race
    loadTerminal = true;
    loadInFlight = false;
    clearStallTimer();
    // Log the raw value so a non-Error thrown value is still visible in the
    // offscreen console (FR-1); message+stack are in err when it is an Error.
    console.error(err);
    post({
      type: "MODEL_STATUS",
      status: "error",
      message: deriveErrorMessage(err),
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

  if (currentRequestId !== requestId) {
    // A newer request has already won; still notify the service worker (with
    // `superseded: true`) so it drops this request's `pendingAnalyses` entry
    // instead of it accumulating there for the rest of the session.
    post({ type: "INFERENCE_RESULT", requestId, result, superseded: true });
    return;
  }
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
