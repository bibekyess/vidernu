import { describe, expect, it } from "vitest";

import { isAnalysisError, makeAnalysisError, validateAnalysis } from "../src/shared/schema";

function validPayload() {
  return {
    translation: { literal: "I go to school.", natural: "I'm heading to school." },
    deconstruction: [
      { token: "학교", root: "학교", part_of_speech: "noun", role_or_meaning: "school" },
      {
        token: "에",
        root: "에",
        part_of_speech: "particle",
        role_or_meaning: "destination marker",
      },
    ],
    context: "Plain/informal register.",
    grammar_rules: ["Destination particle -에 marks a place of movement."],
  };
}

describe("validateAnalysis", () => {
  it("accepts a fully populated valid object", () => {
    expect(validateAnalysis(validPayload())).toEqual(validPayload());
  });

  it("accepts empty deconstruction/grammar_rules and empty strings (FR-5.21 clean degradation)", () => {
    const payload = {
      translation: { literal: "", natural: "" },
      deconstruction: [],
      context: "",
      grammar_rules: [],
    };
    expect(validateAnalysis(payload)).toEqual(payload);
  });

  it("rejects a missing translation field", () => {
    const payload = validPayload() as Record<string, unknown>;
    delete payload.translation;
    expect(validateAnalysis(payload)).toBeNull();
  });

  it("rejects a mistyped translation.natural (number instead of string)", () => {
    const payload = validPayload();
    // @ts-expect-error intentionally malformed for the test
    payload.translation.natural = 42;
    expect(validateAnalysis(payload)).toBeNull();
  });

  it("rejects a deconstruction row missing a required key", () => {
    const payload = validPayload() as { deconstruction: Record<string, unknown>[] };
    delete payload.deconstruction[0]!.role_or_meaning;
    expect(validateAnalysis(payload)).toBeNull();
  });

  it("rejects deconstruction that is not an array", () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    payload.deconstruction = "not an array";
    expect(validateAnalysis(payload)).toBeNull();
  });

  it("rejects grammar_rules containing non-string entries", () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    payload.grammar_rules = ["ok", 5];
    expect(validateAnalysis(payload)).toBeNull();
  });

  it("rejects null and non-object input", () => {
    expect(validateAnalysis(null)).toBeNull();
    expect(validateAnalysis("a string")).toBeNull();
    expect(validateAnalysis(42)).toBeNull();
  });
});

describe("makeAnalysisError / isAnalysisError", () => {
  it("produces the exact FR-27 error object", () => {
    expect(makeAnalysisError()).toEqual({
      error: true,
      message:
        "Local structural generation timed out or failed validation. Please retry parsing this line.",
    });
  });

  it("recognizes a valid error object and rejects a normal result", () => {
    expect(isAnalysisError(makeAnalysisError())).toBe(true);
    expect(isAnalysisError(validPayload())).toBe(false);
    expect(isAnalysisError(null)).toBe(false);
  });
});
