import { describe, expect, it } from "vitest";

import {
  isAnalyzeRequest,
  isAnalysisResultMsg,
  isCapabilityMsg,
  isGetState,
  isInferenceResult,
  isLoadModel,
  isModelStatusMsg,
  isRunInference,
  isStateSnapshot,
  isTogglePanel,
} from "../src/shared/messages";

describe("message type guards", () => {
  it("isAnalyzeRequest accepts valid and rejects malformed payloads", () => {
    expect(isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: 1, text: "hi" })).toBe(true);
    expect(
      isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: 1, text: "hi", lang: "ko" }),
    ).toBe(true);
    expect(isAnalyzeRequest({ type: "ANALYZE_REQUEST", text: "hi" })).toBe(false); // missing requestId
    expect(isAnalyzeRequest({ type: "ANALYZE_REQUEST", requestId: "1", text: "hi" })).toBe(false);
    expect(isAnalyzeRequest({ type: "WRONG_TYPE", requestId: 1, text: "hi" })).toBe(false);
    expect(isAnalyzeRequest(null)).toBe(false);
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
    expect(isRunInference({ type: "RUN_INFERENCE", requestId: 1, text: "hi" })).toBe(true);
    expect(isRunInference({ type: "RUN_INFERENCE", requestId: 1 })).toBe(false); // missing text
    expect(isRunInference({ type: "RUN_INFERENCE", requestId: 1, text: 5 })).toBe(false);
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
    expect(isInferenceResult({ type: "INFERENCE_RESULT", requestId: 1, result: {} })).toBe(true);
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
        analyzedLine: "line",
        result: {},
      }),
    ).toBe(true);
    expect(isAnalysisResultMsg({ type: "ANALYSIS_RESULT", requestId: 1, result: {} })).toBe(false);
  });
});
