import { describe, expect, it } from "vitest";

import { extractGeneratedText, sanitizeAndParse } from "../src/shared/sanitize";

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

  it("extracts assistant content from chat-style generated_text arrays", () => {
    const output = [
      {
        generated_text: [
          { role: "user", content: "prompt" },
          { role: "assistant", content: JSON.stringify(VALID_OBJECT) },
        ],
      },
    ];
    expect(extractGeneratedText(output)).toBe(JSON.stringify(VALID_OBJECT));
  });

  it("parses end-to-end from a chat-style generated_text array", () => {
    const output = [
      {
        generated_text: [
          { role: "user", content: "prompt" },
          { role: "assistant", content: JSON.stringify(VALID_OBJECT) },
        ],
      },
    ];
    expect(sanitizeAndParse(extractGeneratedText(output))).toEqual(VALID_OBJECT);
  });

  it("still handles a plain string generated_text (non-chat shape)", () => {
    const output = [{ generated_text: JSON.stringify(VALID_OBJECT) }];
    const text = extractGeneratedText(output);
    expect(text).toBe(JSON.stringify(VALID_OBJECT));
    expect(sanitizeAndParse(text)).toEqual(VALID_OBJECT);
  });

  it("falls back to the user turn when no assistant turn is present", () => {
    const output = [{ generated_text: [{ role: "user", content: "prompt" }] }];
    const text = extractGeneratedText(output);
    expect(text).toBe("prompt");
    expect(sanitizeAndParse(text)).toBeNull();
  });

  it("returns an empty string for empty/garbage input", () => {
    expect(extractGeneratedText([])).toBe("");
    expect(extractGeneratedText({})).toBe("");
  });
});
