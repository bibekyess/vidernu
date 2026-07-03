/**
 * Cross-surface constants. Kept dependency-free (no `chrome.*`, no
 * `navigator.gpu`) so this module is importable from pure unit tests.
 */

// Pinned model identity (FR-1.6, FR-10, spec Assumptions). Do not swap models
// silently across sessions.
export const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
export const DEVICE = "webgpu" as const;
// INT4 WebGPU-friendly variant. The exact dtype ids offered by the pinned
// repo could not be verified against the live Hugging Face API in this build
// environment (network policy blocks huggingface.co); `q4f16` is the
// transformers.js v3 convention for an INT4-quantized WebGPU build and is the
// documented assumption to re-verify against the live repo before shipping.
export const DTYPE = "q4f16" as const;

// Low-temperature, bounded-context decoding to favor deterministic, parsable
// structured output (FR-6.24) and to keep footprint bounded (FR-9.32).
export const TEMPERATURE = 0.1;
export const MAX_NEW_TOKENS = 512;

// Per-analysis timeout (FR-7.29). "Tens of seconds" per spec Assumptions.
export const TIMEOUT_MS = 45_000;

// Primary validation targets (FR-8.30b). Other source languages still get
// best-effort English analysis (FR-8.31).
export const VALIDATED_LANGS = ["ko", "ja"] as const;

// FR-27 error object — verbatim per the spec's fixed contract.
export const ANALYSIS_ERROR_MESSAGE =
  "Local structural generation timed out or failed validation. Please retry parsing this line.";

// Badge state machine (FR-1.3).
export type ModelStatus = "standby" | "downloading" | "loading" | "ready" | "error";

export const BADGE_TEXT: Record<ModelStatus, string> = {
  standby: "STBY",
  downloading: "DL",
  loading: "DL",
  ready: "READY",
  error: "ERR",
};

export const BADGE_COLOR: Record<ModelStatus, string> = {
  standby: "#808080",
  downloading: "#1a73e8",
  loading: "#1a73e8",
  ready: "#1e8e3e",
  error: "#d93025",
};

/**
 * Formats the ~4-character badge text for a given status. Chrome's toolbar
 * badge reliably renders only a few characters, so the advancing percentage
 * (FR-1.3) is shown as bare digits during download/load; the full "DL: 45%"
 * wording lives in the badge title/tooltip instead (see `formatBadgeTitle`).
 */
export function formatBadgeText(status: ModelStatus, progress?: number): string {
  if ((status === "downloading" || status === "loading") && typeof progress === "number") {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    return `${clamped}%`;
  }
  return BADGE_TEXT[status];
}

/** Formats the full-text badge tooltip/title for a given status. */
export function formatBadgeTitle(status: ModelStatus, progress?: number): string {
  switch (status) {
    case "standby":
      return "Vidernu — standing by";
    case "downloading":
    case "loading": {
      const clamped =
        typeof progress === "number" ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
      return `Vidernu — downloading model: DL: ${clamped}%`;
    }
    case "ready":
      return "Vidernu — ready, click to open the analysis panel";
    case "error":
      return "Vidernu — model error, click to open the panel for details";
  }
}
