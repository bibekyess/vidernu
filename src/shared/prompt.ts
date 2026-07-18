/**
 * Prompt construction (FR-B1, FR-B1a, FR-8.30/8.31). Pure — returns chat
 * messages for the tokenizer's chat template, no `chrome.*` / model
 * references.
 *
 * Gemma's chat template has no system role, so the system instruction is
 * folded into the first (and only) user turn (see plan Risk & Sequencing).
 *
 * Split into two independent phase prompts (see
 * adr/2026-07-04-two-phase-split-inference-contract.md): `buildQuickPrompt`
 * (translation only) and `buildDetailPrompt` (deconstruction + context +
 * grammar). `buildDetailPrompt` intentionally takes NO translation
 * parameter — FR-B1a requires the detail phase to run independently over
 * the captured source line only, with no Phase-1 output as context. This
 * is enforced structurally: there is no parameter through which a caller
 * could pass a translation, so a future regression would fail to compile
 * (and the prompt.test.ts assertion locks the resulting prompt text).
 */
import { VALIDATED_LANGS } from "./constants";

export interface ChatMessage {
  role: "user";
  content: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ko: "Korean",
  ja: "Japanese",
};

function describeLanguage(lang: string | undefined): string {
  if (!lang) return "the source language of the caption (unspecified — infer it from the text)";
  const name = LANGUAGE_NAMES[lang];
  return name ? `${name} (${lang})` : lang;
}

function isValidatedLang(lang: string | undefined): boolean {
  return !!lang && (VALIDATED_LANGS as readonly string[]).includes(lang);
}

function bestEffortNote(lang: string | undefined): string {
  return isValidatedLang(lang)
    ? ""
    : "\nThis source language is not one of Vidernu's primary validated languages (Korean, " +
        "Japanese). Still attempt a best-effort analysis using the same JSON schema.";
}

function singleUserTurn(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

/**
 * Builds the single-turn chat prompt for the quick (translation-only) phase
 * (FR-A1, FR-B1). Each call is independent — no accumulated history is
 * passed in or returned (FR-A7: stateless, single-turn, no growing
 * context/KV-cache).
 */
export function buildQuickPrompt(text: string, lang?: string): ChatMessage[] {
  const languageDescription = describeLanguage(lang);

  const instruction = `You are a language-learning assistant embedded in a browser extension. \
Translate the following single subtitle line, written in ${languageDescription}.

Respond with ONLY a single JSON object — no markdown code fences, no prose before or after it — \
conforming exactly to this schema:
{
  "translation": { "literal": string, "natural": string }
}

Rules:
- "translation.literal" and "translation.natural" MUST be written in English, regardless of the \
source language.
- "literal" is a word-for-word rendering; "natural" is an idiomatic, natural-sounding English \
rendering of the same line.
- If a field has nothing to report, use an empty string — do not omit the field.
- Output only the JSON object. Do not include any other text.${bestEffortNote(lang)}

Subtitle line to translate:
"""
${text}
"""`;

  return singleUserTurn(instruction);
}

/**
 * Builds the single-turn chat prompt for the detail (deconstruction +
 * context + grammar) phase (FR-A3, FR-B1). Runs independently over the
 * captured source line only — takes no translation parameter (FR-B1a).
 */
export function buildDetailPrompt(text: string, lang?: string): ChatMessage[] {
  const languageDescription = describeLanguage(lang);

  const instruction = `You are a language-learning assistant embedded in a browser extension. \
Analyze the following single subtitle line, written in ${languageDescription}.

Respond with ONLY a single JSON object — no markdown code fences, no prose before or after it — \
conforming exactly to this schema:
{
  "deconstruction": [ { "token": string, "root": string, "part_of_speech": string, "role_or_meaning": string } ],
  "context": string,
  "grammar_rules": string[]
}

Rules:
- All natural-language explanatory text (part_of_speech, role_or_meaning, context, and every \
entry in grammar_rules) MUST be written in English, regardless of the source language.
- "token" and "root" MUST be kept verbatim in the original source language — do not translate \
or transliterate them.
- "deconstruction" MUST split complex verbs from their suffixes and identify grammatical \
particles as separate rows.
- "context" MUST describe tone, formality/honorifics, and any colloquialisms present in the line.
- "grammar_rules" MUST list textbook-style rule references (in English) for the grammar used.
- If a field has nothing to report, use an empty string or empty array — do not omit the field.
- Output only the JSON object. Do not include any other text.${bestEffortNote(lang)}

Subtitle line to analyze:
"""
${text}
"""`;

  return singleUserTurn(instruction);
}
