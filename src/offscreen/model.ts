/**
 * Owns the transformers.js pipeline singleton (FR-1). Weights persist in
 * Cache Storage via `env.useBrowserCache` — handled entirely by the
 * library, so a later session does not re-download them (FR-1.1/1.2) and a
 * storage eviction simply triggers a fresh fetch next time (edge case).
 */
import {
  env,
  pipeline,
  type ProgressInfo,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

import {
  DEVICE,
  DTYPE,
  MODEL_ID,
  MODEL_LOAD_FALLBACK_MESSAGE,
  type ModelStatus,
} from "../shared/constants";

env.allowLocalModels = false;
env.useBrowserCache = true;

// MV3 forbids remote script execution (script-src 'self' only). By default,
// transformers.js sets wasmPaths to cdn.jsdelivr.net when running in Chrome,
// which Chrome blocks as a CSP violation. Setting wasmPaths here — before any
// pipeline() call — prevents transformers.js from overwriting it with the CDN
// URL (it only sets the CDN path when wasmPaths is falsy).
//
// The ORT asyncify variant (.mjs + .wasm) is copied into dist/ort/ at build
// time (see vite.config.ts copyOrtRuntime plugin) from the exact onnxruntime-web
// version that transformers.js resolves, so versions can never drift.
//
// chrome.runtime.getURL resolves to chrome-extension://<id>/ort/... which
// matches script-src 'self' for the offscreen document.
const ortBase = chrome.runtime.getURL("ort/");
// env.backends.onnx is Partial<OrtEnv> so wasm may be undefined on the type,
// but transformers.js initialises it unconditionally before this module runs.
// The non-null assertion matches the runtime guarantee; remove if the upstream
// type is tightened in a future release.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
};

let pipelinePromise: Promise<TextGenerationPipeline> | null = null;

export interface LoadProgress {
  status: ModelStatus;
  progress?: number;
}

export type ProgressListener = (progress: LoadProgress) => void;

// Per-file byte progress, aggregated into one overall percentage (FR-1.3:
// "the percentage MUST advance as the download progresses").
const fileProgress = new Map<string, { loaded: number; total: number }>();

function aggregateProgress(): number {
  const entries = [...fileProgress.values()];
  const loaded = entries.reduce((sum, e) => sum + e.loaded, 0);
  const total = entries.reduce((sum, e) => sum + e.total, 0);
  return total > 0 ? (loaded / total) * 100 : 0;
}

function toLoadProgress(info: ProgressInfo): LoadProgress | null {
  switch (info.status) {
    case "initiate":
    case "download":
      return { status: "downloading", progress: aggregateProgress() };
    case "progress":
      if (info.file) {
        fileProgress.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      }
      return { status: "downloading", progress: aggregateProgress() };
    // The "done" event signals all files have been fetched; the model is now
    // compiling/initialising (the "loading" phase), not still downloading (FR-7).
    case "done":
      return { status: "loading" };
    case "ready":
      // Weights are fetched; the model/session is being instantiated.
      return { status: "loading" };
    default:
      return null;
  }
}

/**
 * Loads (or returns the already-loading/loaded) singleton pipeline. A
 * failure clears the singleton so the next `LOAD_MODEL` retries from
 * scratch rather than permanently wedging in an error state (edge case:
 * network drop / corrupt weights).
 */
export function loadModel(onProgress: ProgressListener): Promise<TextGenerationPipeline> {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = pipeline("text-generation", MODEL_ID, {
    device: DEVICE,
    dtype: DTYPE,
    progress_callback: (info: ProgressInfo) => {
      const mapped = toLoadProgress(info);
      if (mapped) onProgress(mapped);
    },
  })
    .then((p) => {
      // Best-effort: report the effective ONNX execution backend so the user
      // can confirm inference is on WebGPU and not silently falling back to
      // slow WASM/CPU. executionProviders is not in the public types, so we
      // read it via an unknown cast — if it isn't there at runtime the log
      // still shows the configured device/dtype.
      const sessionMeta = (p as unknown as { _session?: { executionProviders?: string[] } })
        ._session;
      const providers = sessionMeta?.executionProviders ?? [];
      console.log(
        "[Vidernu][model]",
        "pipeline ready — configured device:",
        DEVICE,
        "dtype:",
        DTYPE,
        "wasmPaths base:",
        env.backends.onnx.wasm?.wasmPaths,
        providers.length > 0
          ? `effective executionProviders: ${providers.join(", ")}`
          : "(executionProviders not readable from public API — confirm WebGPU via DevTools Performance panel)",
      );
      return p;
    })
    .catch((err: unknown) => {
      pipelinePromise = null;
      throw err;
    });

  return pipelinePromise;
}

/** The already-resolved pipeline, if loaded; throws if `loadModel` hasn't completed. */
export async function getPipeline(): Promise<TextGenerationPipeline> {
  if (!pipelinePromise) {
    throw new Error("Model has not been loaded yet.");
  }
  return pipelinePromise;
}

/**
 * Clears the pipeline singleton so the next LOAD_MODEL starts a fresh load.
 * Called by the stall-timeout path in the offscreen document so a timeout
 * leaves the system retryable (FR-13); loadModel already resets on catch.
 */
export function resetPipeline(): void {
  pipelinePromise = null;
}

/**
 * Returns a readable single-line error message for the panel (FR-2). Uses the
 * Error.message when it is a non-empty string; falls back to the generic
 * message so non-Error throws (strings, objects) are handled gracefully.
 * Multi-line messages are collapsed to one line.
 */
export function deriveErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim() !== "") {
    return err.message.replace(/\s+/g, " ").trim();
  }
  return MODEL_LOAD_FALLBACK_MESSAGE;
}
