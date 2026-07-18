import { describe, expect, it } from "vitest";

import { buildDetailPrompt, buildQuickPrompt } from "../src/shared/prompt";

describe("buildQuickPrompt", () => {
  it("returns a single user-role turn (Gemma has no system role)", () => {
    const messages = buildQuickPrompt("안녕하세요", "ko");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
  });

  it("includes only the translation schema keys and the source line", () => {
    const { content } = buildQuickPrompt("안녕하세요", "ko")[0]!;
    for (const key of ["translation", "literal", "natural"]) {
      expect(content).toContain(key);
    }
    expect(content).toContain("안녕하세요");
  });

  it("does not include the detail-phase schema keys (FR-B1 — quick returns only translation)", () => {
    const { content } = buildQuickPrompt("안녕하세요", "ko")[0]!;
    for (const key of ["deconstruction", "grammar_rules", "part_of_speech", "role_or_meaning"]) {
      expect(content).not.toContain(key);
    }
  });

  it("instructs English-only explanatory output", () => {
    const { content } = buildQuickPrompt("안녕하세요", "ko")[0]!;
    expect(content).toMatch(/MUST be written in English/);
  });

  it("names the language for a validated language (Korean)", () => {
    const { content } = buildQuickPrompt("안녕하세요", "ko")[0]!;
    expect(content).toContain("Korean (ko)");
    expect(content).not.toContain("not one of Vidernu's primary validated languages");
  });

  it("names the language for a validated language (Japanese)", () => {
    const { content } = buildQuickPrompt("こんにちは", "ja")[0]!;
    expect(content).toContain("Japanese (ja)");
  });

  it("adds a best-effort note for a non-validated language", () => {
    const { content } = buildQuickPrompt("Hallo", "de")[0]!;
    expect(content).toContain("de");
    expect(content).toContain("not one of Vidernu's primary validated languages");
  });

  it("falls back gracefully when no language is known", () => {
    const { content } = buildQuickPrompt("some text", undefined)[0]!;
    expect(content).toContain("infer it from the text");
  });
});

describe("buildDetailPrompt", () => {
  it("has no translation parameter — the detail phase cannot receive Phase-1 output (FR-B1a)", () => {
    // Structural lock: buildDetailPrompt's declared arity is (text, lang) —
    // two parameters — there is no third "translation" parameter through
    // which a caller could pass Phase-1 output. A future regression that
    // adds one would change this length and fail this assertion.
    expect(buildDetailPrompt.length).toBe(2);
  });

  it("returns a single user-role turn", () => {
    const messages = buildDetailPrompt("안녕하세요", "ko");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
  });

  it("includes the three heavy-section schema keys and the source line", () => {
    const { content } = buildDetailPrompt("안녕하세요", "ko")[0]!;
    for (const key of [
      "deconstruction",
      "token",
      "root",
      "part_of_speech",
      "role_or_meaning",
      "context",
      "grammar_rules",
    ]) {
      expect(content).toContain(key);
    }
    expect(content).toContain("안녕하세요");
  });

  it("does not embed a translation object or any translation string (FR-B1a)", () => {
    const { content } = buildDetailPrompt("안녕하세요", "ko")[0]!;
    expect(content).not.toContain('"translation"');
    expect(content).not.toContain('"literal"');
    expect(content).not.toContain('"natural"');
  });

  it("instructs English-only explanatory output and verbatim source tokens", () => {
    const { content } = buildDetailPrompt("안녕하세요", "ko")[0]!;
    expect(content).toMatch(/MUST be written\s*\n?\s*in English/);
    expect(content).toMatch(/kept verbatim in the original source language/);
  });

  it("names the language for a validated language (Korean)", () => {
    const { content } = buildDetailPrompt("안녕하세요", "ko")[0]!;
    expect(content).toContain("Korean (ko)");
    expect(content).not.toContain("not one of Vidernu's primary validated languages");
  });

  it("adds a best-effort note for a non-validated language", () => {
    const { content } = buildDetailPrompt("Hallo", "de")[0]!;
    expect(content).toContain("de");
    expect(content).toContain("not one of Vidernu's primary validated languages");
  });

  it("falls back gracefully when no language is known", () => {
    const { content } = buildDetailPrompt("some text", undefined)[0]!;
    expect(content).toContain("infer it from the text");
  });
});
