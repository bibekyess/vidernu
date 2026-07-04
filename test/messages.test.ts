import { describe, expect, it } from "vitest";

import {
  isAnalysisPhase,
  isAnalyzeRequest,
  isAnalysisResultMsg,
  isCapabilityMsg,
  isGetState,
  isInferenceResult,
  isLoadModel,
  isModelStatusMsg,
  isRunInference,
  isStateSnapshot,
  isStopAnalysis,
  isStopInference,
  isTogglePanel,
} from "../src/shared/messages";

describe("message type guards", () => {
  it("isAnalysisPhase accepts quick/detail and rejects anything else", () => {
    expect(isAnalysisPhase("quick")).toBe(true);
    expect(isAnalysisPhase("detail")).toBe(true);
    expect(isAnalysisPhase("bogus")).toBe(false);
    expect(isAnalysisPhase(undefined)).toBe(false);
  });

  it("isAnalyzeRequest accepts valid and rejects malformed payloads", () => {
    expect(
      isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: 1, phase: "quick", text: "hi" }),
    ).toBe(true);
    expect(
      isAnalyzeRequest({
        type: "ANALYZE_REQUEST",
        requestId: 1,
        phase: "detail",
        text: "hi",
        lang: "ko",
      }),
    ).toBe(true);
    expect(isAnalyzeRequest({ type: "ANALYZE_REQUEST", phase: "quick", text: "hi" })).toBe(false); // missing requestId
    expect(
      isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: "1", phase: "quick", text: "hi" }),
    ).toBe(false);
    expect(isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: 1, text: "hi" })).toBe(false); // missing phase
    expect(
      isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: 1, phase: "bogus", text: "hi" }),
    ).toBe(false);
    expect(isAnalyzeRequest({ type: "WRONG_TYPE", requestId: 1, phase: "quick", text: "hi" })).toBe(
      false,
    );
    expect(isAnalyzeRequest(null)).toBe(false);
  });

  it("isStopAnalysis accepts valid and rejects malformed payloads", () => {
    expect(isStopAnalysis({ type: "STOP_ANALYSIS", requestId: 1, phase: "quick" })).toBe(true);
    expect(isStopAnalysis({ type: "STOP_ANALYSIS", requestId: 1, phase: "detail" })).toBe(true);
    expect(isStopAnalysis({ type: "STOP_ANALYSIS", phase: "quick" })).toBe(false); // missing requestId
    expect(isStopAnalysis({ type: "STOP_ANALYSIS", requestId: 1 })).toBe(false); // missing phase
    expect(isStopAnalysis({ type: "STOP_ANALYSIS", requestId: 1, phase: "bogus" })).toBe(false);
    expect(isStopAnalysis(null)).toBe(false);
  });

  it("isStopInference accepts valid and rejects malformed payloads", () => {
    expect(isStopInference({ type: "STOP_INFERENCE", requestId: 1 })).toBe(true);
    expect(isStopInference({ type: "STOP_INFERENCE" })).toBe(false);
    expect(isStopInference({ type: "STOP_INFERENCE", requestId: "1" })).toBe(false);
  });

  it("isGetState accepts only its own type", () => {
    expect(isGetState({ type: "GET_STATE" })).toBe(true);
    expect(isGetState({ type: "ANALYZE_REQUEST" })).toBe(false);
  });

  it("isTogglePanel accepts only its own type", () => {
    expect(isTogglePanel({ type: "TOGGLE_PANEL" })).toBe(true);
    expect(isTogglePanel({ type: "GET_STATE" })).toBe(false);
  });

  it("isLoadModel accepts only its own type", () => {
    expect(isLoadModel({ type: "LOAD_MODEL" })).toBe(true);
    expect(isLoadModel({})).toBe(false);
  });

  it("isRunInference accepts valid and rejects malformed payloads", () => {
    expect(
      isRunInference({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "hi" }),
    ).toBe(true);
    expect(isRunInference({ type: "RUN_INFERENCE", requestId: 1, phase: "quick" })).toBe(false); // missing text
    expect(isRunInference({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: 5 })).toBe(
      false,
    );
    expect(isRunInference({ type: "RUN_INFERENCE", requestId: 1, text: "hi" })).toBe(false); // missing phase
  });

  it("isModelStatusMsg accepts each known status and rejects unknown ones", () => {
    for (const status of ["standby", "downloading", "loading", "ready", "error"]) {
      expect(isModelStatusMsg({ type: "MODEL_STATUS", status })).toBe(true);
    }
    expect(isModelStatusMsg({ type: "MODEL_STATUS", status: "downloading", progress: 45 })).toBe(
      true,
    );
    expect(isModelStatusMsg({ type: "MODEL_STATUS", status: "bogus" })).toBe(false);
    expect(isModelStatusMsg({ type: "MODEL_STATUS", status: "downloading", progress: "45" })).toBe(
      false,
    );
  });

  it("isCapabilityMsg accepts valid and rejects malformed payloads", () => {
    expect(isCapabilityMsg({ type: "CAPABILITY", webgpu: true })).toBe(true);
    expect(
      isCapabilityMsg({ type: "CAPABILITY", webgpu: false, lowPowerHint: true, adapterInfo: "x" }),
    ).toBe(true);
    expect(isCapabilityMsg({ type: "CAPABILITY", webgpu: "yes" })).toBe(false);
  });

  it("isInferenceResult accepts valid and rejects malformed payloads", () => {
    expect(
      isInferenceResult({ type: "INFERENCE_RESULT", requestId: 1, phase: "quick", result: {} }),
    ).toBe(true);
    expect(isInferenceResult({ type: "INFERENCE_RESULT", requestId: 1, result: {} })).toBe(false); // missing phase
    expect(isInferenceResult({ type: "INFERENCE_RESULT" })).toBe(false);
  });

  it("isStateSnapshot accepts valid and rejects malformed payloads", () => {
    expect(isStateSnapshot({ type: "STATE", modelStatus: "ready", webgpu: true })).toBe(true);
    expect(isStateSnapshot({ type: "STATE", modelStatus: "bogus", webgpu: true })).toBe(false);
    expect(isStateSnapshot({ type: "STATE", modelStatus: "ready", webgpu: "true" })).toBe(false);
  });

  it("isAnalysisResultMsg accepts valid and rejects malformed payloads", () => {
    expect(
      isAnalysisResultMsg({
        type: "ANALYSIS_RESULT",
        requestId: 1,
        phase: "detail",
        analyzedLine: "line",
        result: {},
      }),
    ).toBe(true);
    expect(
      isAnalysisResultMsg({ type: "ANALYSIS_RESULT", requestId: 1, phase: "quick", result: {} }),
    ).toBe(false); // missing analyzedLine
    expect(
      isAnalysisResultMsg({ type: "ANALYSIS_RESULT", requestId: 1, analyzedLine: "l", result: {} }),
    ).toBe(false); // missing phase
  });
});

// Step 2: isStateSnapshot guard update — accepts optional message field.
describe("isStateSnapshot: optional message field (Step 2 / FR-3)", () => {
  it("accepts a snapshot with message:'boom'", () => {
    expect(
      isStateSnapshot({ type: "STATE", modelStatus: "error", webgpu: true, message: "boom" }),
    ).toBe(true);
  });

  it("accepts a snapshot without a message field", () => {
    expect(isStateSnapshot({ type: "STATE", modelStatus: "ready", webgpu: true })).toBe(true);
  });

  it("rejects a snapshot where message is not a string", () => {
    expect(isStateSnapshot({ type: "STATE", modelStatus: "error", webgpu: true, message: 5 })).toBe(
      false,
    );
  });
});
