/**
 * Sanitization/repair pass for raw model output (FR-7.26/7.27). Pure — the
 * repair strategy is intentionally small and hand-written (no
 * jsonrepair/zod dependency, see plan) so every branch is unit-tested.
 */
import { type AnalysisResult, validateAnalysis } from "./schema";

const CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractGeneratedText(output: unknown): string {
  if (Array.isArray(output)) {
    let fallback = "";

    for (const item of output) {
      const candidate = extractGeneratedText(item);
      if (candidate && !fallback) {
        fallback = candidate;
      }
    }

    return fallback;
  }

  if (isRecord(output)) {
    const generatedText = output.generated_text;
    if (typeof generatedText === "string") {
      return generatedText;
    }

    if (Array.isArray(generatedText)) {
      let fallbackText = "";

      for (const item of generatedText) {
        if (isRecord(item)) {
          const role = typeof item.role === "string" ? item.role : undefined;
          const content = typeof item.content === "string" ? item.content : undefined;

          if (content && role === "assistant") {
            return content;
          }

          if (content && !fallbackText) {
            fallbackText = content;
          }
        }
      }

      return fallbackText;
    }

    if (typeof output.role === "string" || typeof output.content === "string") {
      const role = typeof output.role === "string" ? output.role : undefined;
      const content = typeof output.content === "string" ? output.content : undefined;
      if (content && role === "assistant") {
        return content;
      }
      if (content) {
        return content;
      }
    }
  }

  return "";
}

/** Strips ```json / ``` fenced blocks, returning the inner content if found. */
function stripFences(raw: string): string {
  const match = CODE_FENCE_RE.exec(raw);
  return match ? (match[1] ?? "") : raw;
}

/** Slices from the first `{` to the last `}` to drop leading/trailing prose. */
function sliceToJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

/** Bounded, best-effort repairs for near-valid JSON. */
function repair(candidate: string): string {
  return candidate
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1"); // trailing commas before } or ]
}

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/**
 * Sanitizes and parses raw model output into a validated `AnalysisResult`,
 * or `null` if it cannot be recovered even after repair (the caller then
 * surfaces the FR-27 error object).
 */
export function sanitizeAndParse(raw: string): AnalysisResult | null {
  const unfenced = stripFences(raw);
  const sliced = sliceToJsonObject(unfenced);
  if (sliced === null) return null;

  const direct = tryParse(sliced);
  if (direct !== undefined) {
    const validated = validateAnalysis(direct);
    if (validated) return validated;
  }

  const repaired = tryParse(repair(sliced));
  if (repaired !== undefined) {
    const validated = validateAnalysis(repaired);
    if (validated) return validated;
  }

  return null;
}
