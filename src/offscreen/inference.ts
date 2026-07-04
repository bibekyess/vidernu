/**
 * Single-turn, stateless inference over one subtitle line (FR-6, FR-9). No
 * conversation history or KV-cache is retained across calls — each call
 * builds a fresh prompt and asks for a fresh pipeline invocation.
 */
import {
  InterruptableStoppingCriteria,
  StoppingCriteriaList,
  type TextGenerationOutput,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

import { MAX_NEW_TOKENS, TEMPERATURE } from "../shared/constants";
import { buildPrompt } from "../shared/prompt";
import { sanitizeAndParse } from "../shared/sanitize";
import { type AnalysisError, type AnalysisResult, makeAnalysisError } from "../shared/schema";
import { getPipeline } from "./model";

// How often to poll `isSuperseded` during generation. A WebGPU generation
// cannot be hard-aborted mid-kernel, so cancellation is cooperative (see
// adr/2026-07-03-offscreen-document-owns-webgpu-inference.md).
const SUPERSESSION_POLL_MS = 200;

/**
 * Runs one inference. `isSuperseded` is polled while generating so a newer
 * trigger (or a timeout, see offscreen.ts) can stop a stale generation
 * (FR-17 latest-wins).
 */
export async function runInference(
  text: string,
  lang: string | undefined,
  isSuperseded: () => boolean,
): Promise<AnalysisResult | AnalysisError> {
  const generator = await getPipeline();
  const messages = buildPrompt(text, lang);

  const criteria = new InterruptableStoppingCriteria();
  const stoppingCriteria = new StoppingCriteriaList();
  stoppingCriteria.push(criteria);

  const pollId = setInterval(() => {
    if (isSuperseded()) criteria.interrupt();
  }, SUPERSESSION_POLL_MS);

  // `stopping_criteria` is accepted by transformers.js's generate() at runtime
  // but TextGenerationConfig is an internal typedef not re-exported from the
  // package root, so we derive the pipeline's second-argument type structurally
  // and cast the extra field in. This keeps the known fields type-checked while
  // suppressing the excess-property error for a field that genuinely exists.
  type PipelineOptions = Parameters<TextGenerationPipeline["_call"]>[1];
  const generateOptions: PipelineOptions & { stopping_criteria: StoppingCriteriaList } = {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: true,
    temperature: TEMPERATURE,
    return_full_text: false,
    stopping_criteria: stoppingCriteria,
  } as PipelineOptions & { stopping_criteria: StoppingCriteriaList };

  try {
    const output = (await generator(messages, generateOptions)) as TextGenerationOutput;

    if (isSuperseded()) return makeAnalysisError();

    const first = Array.isArray(output) ? output[0] : undefined;
    const generatedText = typeof first?.generated_text === "string" ? first.generated_text : "";
    return sanitizeAndParse(generatedText) ?? makeAnalysisError();
  } catch {
    return makeAnalysisError();
  } finally {
    clearInterval(pollId);
  }
}
