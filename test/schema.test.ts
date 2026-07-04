import { describe, expect, it } from "vitest";

import {
  isAnalysisError,
  makeAnalysisError,
  validateDetail,
  validateQuick,
} from "../src/shared/schema";

function validQuickPayload() {
  return {
    translation: { literal: "I go to school.", natural: "I'm heading to school." },
  };
}

function validDetailPayload() {
  return {
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

describe("validateQuick", () => {
  it("accepts a fully populated valid object", () => {
    expect(validateQuick(validQuickPayload())).toEqual(validQuickPayload());
  });

  it("accepts empty strings (FR-5.21 clean degradation)", () => {
    const payload = { translation: { literal: "", natural: "" } };
    expect(validateQuick(payload)).toEqual(payload);
  });

  it("rejects a missing translation field", () => {
    expect(validateQuick({})).toBeNull();
  });

  it("rejects a mistyped translation.natural (number instead of string)", () => {
    const payload = validQuickPayload();
    // @ts-expect-error intentionally malformed for the test
    payload.translation.natural = 42;
    expect(validateQuick(payload)).toBeNull();
  });

  it("rejects null and non-object input", () => {
    expect(validateQuick(null)).toBeNull();
    expect(validateQuick("a string")).toBeNull();
    expect(validateQuick(42)).toBeNull();
  });

  it("ignores extraneous detail-phase fields on an otherwise valid quick payload", () => {
    const payload = { ...validQuickPayload(), ...validDetailPayload() };
    expect(validateQuick(payload)).toEqual(validQuickPayload());
  });
});

describe("validateDetail", () => {
  it("accepts a fully populated valid object", () => {
    expect(validateDetail(validDetailPayload())).toEqual(validDetailPayload());
  });

  it("accepts empty deconstruction/grammar_rules and empty context (FR-5.21 clean degradation)", () => {
    const payload = { deconstruction: [], context: "", grammar_rules: [] };
    expect(validateDetail(payload)).toEqual(payload);
  });

  it("rejects a deconstruction row missing a required key", () => {
    const payload = validDetailPayload() as { deconstruction: Record<string, unknown>[] };
    delete payload.deconstruction[0]!.role_or_meaning;
    expect(validateDetail(payload)).toBeNull();
  });

  it("rejects deconstruction that is not an array", () => {
    const payload = validDetailPayload() as unknown as Record<string, unknown>;
    payload.deconstruction = "not an array";
    expect(validateDetail(payload)).toBeNull();
  });

  it("rejects a missing context field", () => {
    const payload = validDetailPayload() as Record<string, unknown>;
    delete payload.context;
    expect(validateDetail(payload)).toBeNull();
  });

  it("rejects grammar_rules containing non-string entries", () => {
    const payload = validDetailPayload() as unknown as Record<string, unknown>;
    payload.grammar_rules = ["ok", 5];
    expect(validateDetail(payload)).toBeNull();
  });

  it("rejects null and non-object input", () => {
    expect(validateDetail(null)).toBeNull();
    expect(validateDetail("a string")).toBeNull();
    expect(validateDetail(42)).toBeNull();
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
    expect(isAnalysisError(validQuickPayload())).toBe(false);
    expect(isAnalysisError(validDetailPayload())).toBe(false);
    expect(isAnalysisError(null)).toBe(false);
  });
});
