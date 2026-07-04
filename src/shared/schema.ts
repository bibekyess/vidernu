/**
 * The v2 split inference contract (FR-B1/B2) and the FR-27 error fallback.
 * Pure — no `chrome.*` or `navigator.gpu` references — so it is
 * unit-testable in isolation. See
 * adr/2026-07-04-two-phase-split-inference-contract.md.
 */
import { ANALYSIS_ERROR_MESSAGE } from "./constants";

export interface DeconstructionRow {
  token: string;
  root: string;
  part_of_speech: string;
  role_or_meaning: string;
}

/** Phase-1 (quick) result — translation only (FR-A1/A2, FR-B1). */
export interface QuickResult {
  translation: { literal: string; natural: string };
}

/** Phase-2 (detail) result — the three heavy sections (FR-A3, FR-B1). */
export interface DetailResult {
  deconstruction: DeconstructionRow[];
  context: string;
  grammar_rules: string[];
}

export interface AnalysisError {
  error: true;
  message: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isDeconstructionRow(value: unknown): value is DeconstructionRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isString(row.token) &&
    isString(row.root) &&
    isString(row.part_of_speech) &&
    isString(row.role_or_meaning)
  );
}

/**
 * Validates an unknown parsed value against the quick-phase schema. Empty
 * strings are treated as valid (FR-5.21 clean degradation).
 */
export function validateQuick(value: unknown): QuickResult | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;

  const translation = obj.translation;
  if (typeof translation !== "object" || translation === null) return null;
  const { literal, natural } = translation as Record<string, unknown>;
  if (!isString(literal) || !isString(natural)) return null;

  return { translation: { literal, natural } };
}

/**
 * Validates an unknown parsed value against the detail-phase schema. Empty
 * arrays/strings are treated as valid (FR-5.21 clean degradation).
 */
export function validateDetail(value: unknown): DetailResult | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;

  const deconstruction = obj.deconstruction;
  if (!Array.isArray(deconstruction) || !deconstruction.every(isDeconstructionRow)) return null;

  const context = obj.context;
  if (!isString(context)) return null;

  const grammarRules = obj.grammar_rules;
  if (!Array.isArray(grammarRules) || !grammarRules.every(isString)) return null;

  return {
    deconstruction,
    context,
    grammar_rules: grammarRules,
  };
}

/** The exact FR-27 error object — verbatim, per the spec's fixed contract. */
export function makeAnalysisError(): AnalysisError {
  return { error: true, message: ANALYSIS_ERROR_MESSAGE };
}

export function isAnalysisError(value: unknown): value is AnalysisError {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj.error === true && isString(obj.message);
}
