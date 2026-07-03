/**
 * Sanitization/repair pass for raw model output (FR-7.26/7.27). Pure — the
 * repair strategy is intentionally small and hand-written (no
 * jsonrepair/zod dependency, see plan) so every branch is unit-tested.
 */
import { type AnalysisResult, validateAnalysis } from "./schema";

const CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/i;

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
