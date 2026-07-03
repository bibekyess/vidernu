import { describe, expect, it } from "vitest";

import { buildPrompt } from "../src/shared/prompt";

describe("buildPrompt", () => {
  it("returns a single user-role turn (Gemma has no system role)", () => {
    const messages = buildPrompt("안녕하세요", "ko");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
  });

  it("includes every FR-6 schema key and the source line", () => {
    const { content } = buildPrompt("안녕하세요", "ko")[0]!;
    for (const key of [
      "translation",
      "literal",
      "natural",
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

  it("instructs English-only explanatory output and verbatim source tokens", () => {
    const { content } = buildPrompt("안녕하세요", "ko")[0]!;
    expect(content).toMatch(/MUST be written\s*\n?\s*in English/);
    expect(content).toMatch(/kept verbatim in the original source language/);
  });

  it("names the language for a validated language (Korean)", () => {
    const { content } = buildPrompt("안녕하세요", "ko")[0]!;
    expect(content).toContain("Korean (ko)");
    expect(content).not.toContain("not one of Vidernu's primary validated languages");
  });

  it("names the language for a validated language (Japanese)", () => {
    const { content } = buildPrompt("こんにちは", "ja")[0]!;
    expect(content).toContain("Japanese (ja)");
  });

  it("adds a best-effort note for a non-validated language", () => {
    const { content } = buildPrompt("Hallo", "de")[0]!;
    expect(content).toContain("de");
    expect(content).toContain("not one of Vidernu's primary validated languages");
  });

  it("falls back gracefully when no language is known", () => {
    const { content } = buildPrompt("some text", undefined)[0]!;
    expect(content).toContain("infer it from the text");
  });
});
