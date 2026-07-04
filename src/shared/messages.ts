/**
 * The single typed `chrome.runtime` message union used across the three
 * runtime surfaces (content script / service worker / offscreen document).
 * Pure — no `chrome.*` references — so the type guards are unit-testable.
 *
 * `requestId` is a monotonic number minted by the content script (which
 * hosts the injected panel and its "Analyze current line" button — see
 * adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md); it is
 * threaded through every message of one analysis and is the mechanism
 * behind latest-wins supersession (FR-17).
 *
 * `phase` (added for the 2026-07-04 two-phase split — see
 * adr/2026-07-04-two-phase-split-inference-contract.md) discriminates
 * which of the two independent generations a message belongs to: "quick"
 * (translation only) or "detail" (deconstruction + context + grammar). It
 * is a required field on every analysis-flow message — this is a
 * pre-release internal contract with no external consumer.
 *
 * `STOP_ANALYSIS`/`STOP_INFERENCE` (FR-C, see
 * adr/2026-07-04-user-initiated-cooperative-stop.md) extend the same
 * latest-wins supersession plumbing with an explicit user-initiated cancel
 * marker rather than introducing a parallel cancellation mechanism.
 *
 * Caption capture never crosses a process boundary: because the panel is
 * injected directly into the YouTube page by the content script (rather
 * than hosted as a separate `chrome.sidePanel` page), the content script
 * calls `extractActiveCaption(document)` synchronously and sends the
 * already-captured text as part of `ANALYZE_REQUEST` — there is no
 * `CAPTURE_CAPTION` round trip through the service worker.
 */
import type { AnalysisError, DetailResult, QuickResult } from "./schema";

export type ModelStatusValue = "standby" | "downloading" | "loading" | "ready" | "error";

/** Which of the two independent generations a message belongs to (FR-B1). */
export type AnalysisPhase = "quick" | "detail";

// Content script (panel) -> SW
export interface AnalyzeRequest {
  type: "ANALYZE_REQUEST";
  requestId: number;
  phase: AnalysisPhase;
  text: string;
  lang?: string;
}

// Content script (panel) -> SW: cancel whichever generation `requestId`
// refers to (FR-C1/C2).
export interface StopAnalysis {
  type: "STOP_ANALYSIS";
  requestId: number;
  phase: AnalysisPhase;
}

export interface GetState {
  type: "GET_STATE";
}

// SW -> content script
export interface TogglePanel {
  type: "TOGGLE_PANEL";
}

// SW -> offscreen
export interface LoadModel {
  type: "LOAD_MODEL";
}

export interface RunInference {
  type: "RUN_INFERENCE";
  requestId: number;
  phase: AnalysisPhase;
  text: string;
  lang?: string;
}

// SW -> offscreen: relay of STOP_ANALYSIS (FR-C6).
export interface StopInference {
  type: "STOP_INFERENCE";
  requestId: number;
}

// offscreen -> SW (pushed)
export interface ModelStatusMsg {
  type: "MODEL_STATUS";
  status: ModelStatusValue;
  progress?: number;
  message?: string;
}

export interface CapabilityMsg {
  type: "CAPABILITY";
  webgpu: boolean;
  lowPowerHint?: boolean;
  adapterInfo?: string;
}

export interface InferenceResult {
  type: "INFERENCE_RESULT";
  requestId: number;
  phase: AnalysisPhase;
  result: QuickResult | DetailResult | AnalysisError;
  // Set when a newer RUN_INFERENCE has already superseded this one, or when
  // the request was explicitly stopped (FR-17 latest-wins / FR-C5); lets the
  // service worker drop its pendingAnalyses entry without relaying a stale
  // result to the tab.
  superseded?: boolean;
}

// SW -> content script (panel), pushed or as a GET_STATE reply
export interface StateSnapshot {
  type: "STATE";
  modelStatus: ModelStatusValue;
  progress?: number;
  webgpu: boolean;
  lowPowerHint?: boolean;
  // The single-line error detail from the last MODEL_STATUS error, forwarded
  // so a panel opened after an error still sees it (FR-3). Cleared on non-error. (FR-5)
  message?: string;
}

export interface AnalysisResultMsg {
  type: "ANALYSIS_RESULT";
  requestId: number;
  phase: AnalysisPhase;
  analyzedLine: string;
  result: QuickResult | DetailResult | AnalysisError;
}

export type Message =
  | AnalyzeRequest
  | StopAnalysis
  | GetState
  | TogglePanel
  | LoadModel
  | RunInference
  | StopInference
  | ModelStatusMsg
  | CapabilityMsg
  | InferenceResult
  | StateSnapshot
  | AnalysisResultMsg;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

const ANALYSIS_PHASES: readonly AnalysisPhase[] = ["quick", "detail"];

export function isAnalysisPhase(value: unknown): value is AnalysisPhase {
  return isString(value) && (ANALYSIS_PHASES as readonly string[]).includes(value);
}

export function isAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  return (
    isRecord(value) &&
    value.type === "ANALYZE_REQUEST" &&
    isNumber(value.requestId) &&
    isAnalysisPhase(value.phase) &&
    isString(value.text) &&
    (value.lang === undefined || isString(value.lang))
  );
}

export function isStopAnalysis(value: unknown): value is StopAnalysis {
  return (
    isRecord(value) &&
    value.type === "STOP_ANALYSIS" &&
    isNumber(value.requestId) &&
    isAnalysisPhase(value.phase)
  );
}

export function isGetState(value: unknown): value is GetState {
  return isRecord(value) && value.type === "GET_STATE";
}

export function isTogglePanel(value: unknown): value is TogglePanel {
  return isRecord(value) && value.type === "TOGGLE_PANEL";
}

export function isLoadModel(value: unknown): value is LoadModel {
  return isRecord(value) && value.type === "LOAD_MODEL";
}

export function isRunInference(value: unknown): value is RunInference {
  return (
    isRecord(value) &&
    value.type === "RUN_INFERENCE" &&
    isNumber(value.requestId) &&
    isAnalysisPhase(value.phase) &&
    isString(value.text) &&
    (value.lang === undefined || isString(value.lang))
  );
}

export function isStopInference(value: unknown): value is StopInference {
  return isRecord(value) && value.type === "STOP_INFERENCE" && isNumber(value.requestId);
}

const MODEL_STATUS_VALUES: readonly ModelStatusValue[] = [
  "standby",
  "downloading",
  "loading",
  "ready",
  "error",
];

function isModelStatusValue(value: unknown): value is ModelStatusValue {
  return isString(value) && (MODEL_STATUS_VALUES as readonly string[]).includes(value);
}

export function isModelStatusMsg(value: unknown): value is ModelStatusMsg {
  return (
    isRecord(value) &&
    value.type === "MODEL_STATUS" &&
    isModelStatusValue(value.status) &&
    (value.progress === undefined || isNumber(value.progress)) &&
    (value.message === undefined || isString(value.message))
  );
}

export function isCapabilityMsg(value: unknown): value is CapabilityMsg {
  return (
    isRecord(value) &&
    value.type === "CAPABILITY" &&
    typeof value.webgpu === "boolean" &&
    (value.lowPowerHint === undefined || typeof value.lowPowerHint === "boolean") &&
    (value.adapterInfo === undefined || isString(value.adapterInfo))
  );
}

export function isInferenceResult(value: unknown): value is InferenceResult {
  return (
    isRecord(value) &&
    value.type === "INFERENCE_RESULT" &&
    isNumber(value.requestId) &&
    isAnalysisPhase(value.phase) &&
    (value.superseded === undefined || typeof value.superseded === "boolean")
  );
}

export function isStateSnapshot(value: unknown): value is StateSnapshot {
  return (
    isRecord(value) &&
    value.type === "STATE" &&
    isModelStatusValue(value.modelStatus) &&
    typeof value.webgpu === "boolean" &&
    (value.progress === undefined || isNumber(value.progress)) &&
    (value.lowPowerHint === undefined || typeof value.lowPowerHint === "boolean") &&
    (value.message === undefined || isString(value.message))
  );
}

export function isAnalysisResultMsg(value: unknown): value is AnalysisResultMsg {
  return (
    isRecord(value) &&
    value.type === "ANALYSIS_RESULT" &&
    isNumber(value.requestId) &&
    isAnalysisPhase(value.phase) &&
    isString(value.analyzedLine)
  );
}
