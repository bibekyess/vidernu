/**
 * Prompt construction (FR-6.23, FR-8.30/8.31). Pure — returns chat messages
 * for the tokenizer's chat template, no `chrome.*` / model references.
 *
 * Gemma's chat template has no system role, so the system instruction is
 * folded into the first (and only) user turn (see plan Risk & Sequencing).
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

/**
 * Builds the single-turn chat prompt for one subtitle line. Each call is
 * independent — no accumulated history is passed in or returned (FR-6.25,
 * FR-9: stateless, single-turn, no growing context/KV-cache).
 */
export function buildPrompt(text: string, lang?: string): ChatMessage[] {
  const languageDescription = describeLanguage(lang);
  const bestEffortNote = isValidatedLang(lang)
    ? ""
    : "\nThis source language is not one of Vidernu's primary validated languages (Korean, " +
      "Japanese). Still attempt a best-effort analysis using the same JSON schema.";

  const instruction = `You are a language-learning assistant embedded in a browser extension. \
Analyze the following single subtitle line, written in ${languageDescription}.

Respond with ONLY a single JSON object — no markdown code fences, no prose before or after it — \
conforming exactly to this schema:
{
  "translation": { "literal": string, "natural": string },
  "deconstruction": [ { "token": string, "root": string, "part_of_speech": string, "role_or_meaning": string } ],
  "context": string,
  "grammar_rules": string[]
}

Rules:
- All natural-language explanatory text (translation.literal, translation.natural, \
part_of_speech, role_or_meaning, context, and every entry in grammar_rules) MUST be written \
in English, regardless of the source language.
- "token" and "root" MUST be kept verbatim in the original source language — do not translate \
or transliterate them.
- "deconstruction" MUST split complex verbs from their suffixes and identify grammatical \
particles as separate rows.
- "context" MUST describe tone, formality/honorifics, and any colloquialisms present in the line.
- "grammar_rules" MUST list textbook-style rule references (in English) for the grammar used.
- If a field has nothing to report, use an empty string or empty array — do not omit the field.
- Output only the JSON object. Do not include any other text.${bestEffortNote}

Subtitle line to analyze:
"""
${text}
"""`;

  return [{ role: "user", content: instruction }];
}
