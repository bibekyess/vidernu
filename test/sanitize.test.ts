import { describe, expect, it } from "vitest";

import { sanitizeAndParse } from "../src/shared/sanitize";

const VALID_OBJECT = {
  translation: { literal: "lit", natural: "nat" },
  deconstruction: [],
  context: "",
  grammar_rules: [],
};

describe("sanitizeAndParse", () => {
  it("parses bare, well-formed JSON", () => {
    expect(sanitizeAndParse(JSON.stringify(VALID_OBJECT))).toEqual(VALID_OBJECT);
  });

  it("strips ```json fenced blocks", () => {
    const raw = "```json\n" + JSON.stringify(VALID_OBJECT) + "\n```";
    expect(sanitizeAndParse(raw)).toEqual(VALID_OBJECT);
  });

  it("strips bare ``` fenced blocks (no language tag)", () => {
    const raw = "```\n" + JSON.stringify(VALID_OBJECT) + "\n```";
    expect(sanitizeAndParse(raw)).toEqual(VALID_OBJECT);
  });

  it("extracts JSON with trailing prose", () => {
    const raw = JSON.stringify(VALID_OBJECT) + "\n\nLet me know if you need anything else!";
    expect(sanitizeAndParse(raw)).toEqual(VALID_OBJECT);
  });

  it("extracts JSON with leading prose", () => {
    const raw = "Sure, here is the analysis:\n" + JSON.stringify(VALID_OBJECT);
    expect(sanitizeAndParse(raw)).toEqual(VALID_OBJECT);
  });

  it("repairs a trailing comma before a closing brace", () => {
    const raw = `{"translation":{"literal":"lit","natural":"nat",},"deconstruction":[],"context":"","grammar_rules":[]}`;
    expect(sanitizeAndParse(raw)).toEqual(VALID_OBJECT);
  });

  it("repairs a trailing comma before a closing bracket", () => {
    const raw = `{"translation":{"literal":"lit","natural":"nat"},"deconstruction":[],"context":"","grammar_rules":["a",]}`;
    expect(sanitizeAndParse(raw)).toEqual({ ...VALID_OBJECT, grammar_rules: ["a"] });
  });

  it("returns null for truncated/unrecoverable JSON", () => {
    const raw = `{"translation": {"literal": "lit", "natural": "nat"`;
    expect(sanitizeAndParse(raw)).toBeNull();
  });

  it("returns null for garbage with no JSON object at all", () => {
    expect(sanitizeAndParse("I cannot analyze this line.")).toBeNull();
  });

  it("returns null when the JSON parses but fails schema validation", () => {
    expect(sanitizeAndParse(JSON.stringify({ foo: "bar" }))).toBeNull();
  });
});
