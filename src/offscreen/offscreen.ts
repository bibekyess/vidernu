/**
 * Offscreen document message handler (FR-1, FR-2, FR-6, FR-7, FR-17). Owns
 * the model lifecycle and inference; the service worker never runs
 * inference itself (see ADR).
 */
import { LOAD_STALL_TIMEOUT_MS, LOAD_TIMEOUT_MESSAGE, TIMEOUT_MS } from "../shared/constants";

const LOG_ANALYSIS = "[Vidernu][analysis]";
import {
  type AnalysisPhase,
  type CapabilityMsg,
  isLoadModel,
  isRunInference,
  isStopInference,
  type InferenceResult,
  type ModelStatusMsg,
} from "../shared/messages";
import {
  type AnalysisError,
  type DetailResult,
  type QuickResult,
  makeAnalysisError,
} from "../shared/schema";
import { detectWebGPU } from "./capability";
import { runInference } from "./inference";
import { deriveErrorMessage, loadModel, resetPipeline } from "./model";

// The requestId currently "owned" by this offscreen document. A newer
// RUN_INFERENCE bumps this, marking any older in-flight generation
// superseded (FR-17 latest-wins).
let currentRequestId = 0;

// The requestId explicitly cancelled by a user-initiated Stop (FR-C, see
// adr/2026-07-04-user-initiated-cooperative-stop.md). Widens `isSuperseded`
// so the same InterruptableStoppingCriteria poll that already implements
// latest-wins also implements Stop. Reset to null at the start of every new
// handleRunInference so a stale cancel can never suppress a later
// legitimate result.
let cancelledRequestId: number | null = null;

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

async function handleRunInference(
  requestId: number,
  phase: AnalysisPhase,
  text: string,
  lang?: string,
): Promise<void> {
  currentRequestId = requestId;
  // A stale cancel from a prior request must never suppress this new one.
  if (cancelledRequestId === requestId) cancelledRequestId = null;
  let timedOut = false;
  const isSuperseded = (): boolean =>
    currentRequestId !== requestId || timedOut || cancelledRequestId === requestId;

  // Log when an analysis request arrives so the flow is visible even if
  // inference never reaches runInference (e.g. it times out first).
  console.log(
    LOG_ANALYSIS,
    `request ${requestId} (${phase}) received — text: "${text}", lang: ${lang ?? "none"}, timeout: ${TIMEOUT_MS}ms`,
  );

  const startMs = Date.now();
  const result = await raceTimeout<QuickResult | DetailResult | AnalysisError>(
    runInference(text, lang, phase, isSuperseded),
    TIMEOUT_MS,
    () => {
      const elapsedMs = Date.now() - startMs;
      // Distinguish a timeout (analysis cap reached) from a superseded
      // cancellation inside runInference so the console makes the cause clear.
      console.warn(
        LOG_ANALYSIS,
        `request ${requestId} (${phase}) TIMED OUT after ${elapsedMs}ms (cap: ${TIMEOUT_MS}ms)`,
      );
      timedOut = true;
      return makeAnalysisError();
    },
  );

  if (currentRequestId !== requestId || cancelledRequestId === requestId) {
    // A newer request has already won, or this one was explicitly stopped;
    // still notify the service worker (with `superseded: true`) so it drops
    // this request's `pendingAnalyses` entry instead of it accumulating
    // there for the rest of the session, and so the stopped output never
    // surfaces in the panel (FR-C5).
    console.log(
      LOG_ANALYSIS,
      `request ${requestId} (${phase}) superseded/cancelled — posting with superseded:true`,
    );
    post({ type: "INFERENCE_RESULT", requestId, phase, result, superseded: true });
    return;
  }
  console.log(LOG_ANALYSIS, `request ${requestId} (${phase}) complete — posting result`, result);
  post({ type: "INFERENCE_RESULT", requestId, phase, result });
}

/**
 * Handles a user-initiated Stop (FR-C). Only cancels the currently in-flight
 * request; a stale/late STOP_INFERENCE for a non-current id is a no-op
 * (edge case: stop pressed after the generation already completed).
 */
function handleStopInference(requestId: number): void {
  if (requestId === currentRequestId) {
    cancelledRequestId = requestId;
  }
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
    void handleRunInference(message.requestId, message.phase, message.text, message.lang);
    return;
  }
  if (isStopInference(message)) {
    handleStopInference(message.requestId);
  }
});
