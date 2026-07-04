import { describe, expect, it } from "vitest";

import { extractGeneratedText, parseDetail, parseQuick } from "../src/shared/sanitize";

const VALID_QUICK = {
  translation: { literal: "lit", natural: "nat" },
};

const VALID_DETAIL = {
  deconstruction: [],
  context: "",
  grammar_rules: [],
};

describe("parseQuick", () => {
  it("parses bare, well-formed JSON", () => {
    expect(parseQuick(JSON.stringify(VALID_QUICK))).toEqual(VALID_QUICK);
  });

  it("strips ```json fenced blocks", () => {
    const raw = "```json\n" + JSON.stringify(VALID_QUICK) + "\n```";
    expect(parseQuick(raw)).toEqual(VALID_QUICK);
  });

  it("strips bare ``` fenced blocks (no language tag)", () => {
    const raw = "```\n" + JSON.stringify(VALID_QUICK) + "\n```";
    expect(parseQuick(raw)).toEqual(VALID_QUICK);
  });

  it("extracts JSON with trailing prose", () => {
    const raw = JSON.stringify(VALID_QUICK) + "\n\nLet me know if you need anything else!";
    expect(parseQuick(raw)).toEqual(VALID_QUICK);
  });

  it("extracts JSON with leading prose", () => {
    const raw = "Sure, here is the translation:\n" + JSON.stringify(VALID_QUICK);
    expect(parseQuick(raw)).toEqual(VALID_QUICK);
  });

  it("repairs a trailing comma before a closing brace", () => {
    const raw = `{"translation":{"literal":"lit","natural":"nat",}}`;
    expect(parseQuick(raw)).toEqual(VALID_QUICK);
  });

  it("returns null for truncated/unrecoverable JSON", () => {
    const raw = `{"translation": {"literal": "lit", "natural": "nat"`;
    expect(parseQuick(raw)).toBeNull();
  });

  it("returns null for garbage with no JSON object at all", () => {
    expect(parseQuick("I cannot translate this line.")).toBeNull();
  });

  it("returns null when the JSON parses but fails schema validation", () => {
    expect(parseQuick(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null for a detail-shaped object with no translation field", () => {
    expect(parseQuick(JSON.stringify(VALID_DETAIL))).toBeNull();
  });
});

describe("parseDetail", () => {
  it("parses bare, well-formed JSON", () => {
    expect(parseDetail(JSON.stringify(VALID_DETAIL))).toEqual(VALID_DETAIL);
  });

  it("strips ```json fenced blocks", () => {
    const raw = "```json\n" + JSON.stringify(VALID_DETAIL) + "\n```";
    expect(parseDetail(raw)).toEqual(VALID_DETAIL);
  });

  it("extracts JSON with leading and trailing prose", () => {
    const raw = "Here you go:\n" + JSON.stringify(VALID_DETAIL) + "\nHope that helps!";
    expect(parseDetail(raw)).toEqual(VALID_DETAIL);
  });

  it("repairs a trailing comma before a closing bracket", () => {
    const raw = `{"deconstruction":[],"context":"","grammar_rules":["a",]}`;
    expect(parseDetail(raw)).toEqual({ ...VALID_DETAIL, grammar_rules: ["a"] });
  });

  it("returns null for truncated/unrecoverable JSON", () => {
    const raw = `{"deconstruction": [], "context": "x"`;
    expect(parseDetail(raw)).toBeNull();
  });

  it("returns null for garbage with no JSON object at all", () => {
    expect(parseDetail("I cannot analyze this line.")).toBeNull();
  });

  it("returns null when the JSON parses but fails schema validation", () => {
    expect(parseDetail(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null for a quick-shaped object with no detail fields", () => {
    expect(parseDetail(JSON.stringify(VALID_QUICK))).toBeNull();
  });
});

describe("extractGeneratedText", () => {
  it("extracts assistant content from chat-style generated_text arrays", () => {
    const output = [
      {
        generated_text: [
          { role: "user", content: "prompt" },
          { role: "assistant", content: JSON.stringify(VALID_QUICK) },
        ],
      },
    ];
    expect(extractGeneratedText(output)).toBe(JSON.stringify(VALID_QUICK));
  });

  it("parses end-to-end from a chat-style generated_text array", () => {
    const output = [
      {
        generated_text: [
          { role: "user", content: "prompt" },
          { role: "assistant", content: JSON.stringify(VALID_DETAIL) },
        ],
      },
    ];
    expect(parseDetail(extractGeneratedText(output))).toEqual(VALID_DETAIL);
  });

  it("still handles a plain string generated_text (non-chat shape)", () => {
    const output = [{ generated_text: JSON.stringify(VALID_QUICK) }];
    const text = extractGeneratedText(output);
    expect(text).toBe(JSON.stringify(VALID_QUICK));
    expect(parseQuick(text)).toEqual(VALID_QUICK);
  });

  it("falls back to the user turn when no assistant turn is present", () => {
    const output = [{ generated_text: [{ role: "user", content: "prompt" }] }];
    const text = extractGeneratedText(output);
    expect(text).toBe("prompt");
    expect(parseQuick(text)).toBeNull();
  });

  it("returns an empty string for empty/garbage input", () => {
    expect(extractGeneratedText([])).toBe("");
    expect(extractGeneratedText({})).toBe("");
  });
});
