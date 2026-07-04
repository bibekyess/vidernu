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
import type { AnalysisPhase } from "../shared/messages";
import { buildDetailPrompt, buildQuickPrompt } from "../shared/prompt";
import { extractGeneratedText, parseDetail, parseQuick } from "../shared/sanitize";
import {
  type AnalysisError,
  type DetailResult,
  type QuickResult,
  makeAnalysisError,
} from "../shared/schema";
import { getPipeline } from "./model";

// How often to poll `isSuperseded` during generation. A WebGPU generation
// cannot be hard-aborted mid-kernel, so cancellation is cooperative (see
// adr/2026-07-03-offscreen-document-owns-webgpu-inference.md).
const SUPERSESSION_POLL_MS = 200;

// Flip to false once the structured-output issue is diagnosed.
const DEBUG_INFERENCE = false;

const LOG = "[Vidernu][inference]";

/**
 * Runs one inference for the given phase (FR-B1). `isSuperseded` is polled
 * while generating so a newer trigger, a timeout, or a user-initiated Stop
 * (see offscreen.ts) can halt a stale/cancelled generation (FR-17
 * latest-wins, FR-C3).
 */
export async function runInference(
  text: string,
  lang: string | undefined,
  phase: AnalysisPhase,
  isSuperseded: () => boolean,
): Promise<QuickResult | DetailResult | AnalysisError> {
  // Always log at the start so "was runInference even called?" is answerable
  // without enabling Verbose level in DevTools (console.debug is hidden by default).
  if (DEBUG_INFERENCE) {
    console.log(LOG, "runInference called — phase:", phase, "text:", text, "lang:", lang);
  }

  const generator = await getPipeline();
  const messages = phase === "quick" ? buildQuickPrompt(text, lang) : buildDetailPrompt(text, lang);

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

  if (DEBUG_INFERENCE) {
    console.log(LOG, "messages (prompt):", messages);
    console.log(LOG, "generateOptions:", {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: true,
      temperature: TEMPERATURE,
      return_full_text: false,
    });
  }

  try {
    const output = (await generator(messages, generateOptions)) as TextGenerationOutput;

    if (DEBUG_INFERENCE) {
      console.log(LOG, "raw output object:", output);
    }

    const generatedText = extractGeneratedText(output);

    // Log the raw model text before any superseded/parse branch so a
    // timed-out or interrupted generation still shows what was produced.
    if (DEBUG_INFERENCE) {
      console.log(LOG, "generatedText (raw model output):", generatedText);
    }

    if (isSuperseded()) {
      console.log(LOG, "superseded after generation — discarding result");
      return makeAnalysisError();
    }

    const parsed = phase === "quick" ? parseQuick(generatedText) : parseDetail(generatedText);
    if (parsed === null) {
      // Log the raw text unconditionally so the failure is always visible in
      // the offscreen console, regardless of the DEBUG_INFERENCE flag.
      console.error(
        LOG,
        "sanitizeAndParse returned null — parse/validate failed. Raw generatedText:",
        generatedText,
      );
      return makeAnalysisError();
    }

    if (DEBUG_INFERENCE) {
      console.log(LOG, "parse/validate succeeded:", parsed);
    }

    return parsed;
  } catch (err) {
    console.error(LOG, "generation threw:", err);
    return makeAnalysisError();
  } finally {
    clearInterval(pollId);
  }
}
