import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../src/shared/schema";
import {
  renderAnalysis,
  renderAnalysisError,
  renderLoading,
  renderSkeleton,
  type PanelElements,
} from "../src/sidepanel/render";

const RESULT: AnalysisResult = {
  translation: { literal: "lit", natural: "nat" },
  deconstruction: [],
  context: "ctx",
  grammar_rules: [],
};

describe("render", () => {
  let els: PanelElements;

  beforeEach(() => {
    const container = document.createElement("div");
    els = renderSkeleton(container);
  });

  it("renderLoading shows an in-progress header (FR-20)", () => {
    renderLoading(els, "hello world");
    expect(els.analyzedLine.hidden).toBe(false);
    expect(els.analyzedLine.textContent).toBe('Analyzing: "hello world"');
  });

  it("renderAnalysis replaces the in-progress header once results land", () => {
    renderLoading(els, "hello world");
    renderAnalysis(els, "hello world", RESULT);
    expect(els.analyzedLine.textContent).toBe('Analyzed: "hello world"');
    expect(els.analyzedLine.textContent).not.toContain("Analyzing");
  });

  it("renderAnalysisError also reflects a completed (non-in-progress) request", () => {
    renderLoading(els, "hello world");
    renderAnalysisError(els, "hello world", "Something went wrong.");
    expect(els.analyzedLine.textContent).toBe('Analyzed: "hello world"');
    expect(els.analyzedLine.textContent).not.toContain("Analyzing");
  });
});
