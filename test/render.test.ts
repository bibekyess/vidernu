import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../src/shared/schema";
import {
  renderAnalysis,
  renderAnalysisError,
  renderLoading,
  renderSkeleton,
  setLoadError,
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

// Section A: dedicated load-error area (FR-4/FR-5).
describe("render: dedicated load-error area (Section A)", () => {
  let els: PanelElements;

  beforeEach(() => {
    const container = document.createElement("div");
    els = renderSkeleton(container);
  });

  it("skeleton contains the loadError element and loadErrorRetry button", () => {
    expect(els.loadError).toBeDefined();
    expect(els.loadErrorRetry).toBeDefined();
    expect(els.loadErrorRetry.tagName).toBe("BUTTON");
  });

  it("loadError is hidden initially", () => {
    expect(els.loadError.hidden).toBe(true);
  });

  it("setLoadError shows the error detail and a hint — distinct node from sections (FR-4)", () => {
    setLoadError(els, "boom");
    expect(els.loadError.hidden).toBe(false);
    expect(els.loadError.textContent).toContain("boom");
    // The hint text must be present.
    expect(els.loadError.textContent).toContain("Retry");
    // The loadError node is NOT sections.
    expect(els.loadError).not.toBe(els.sections);
  });

  it("setLoadError(null) hides the area and clears detail (FR-5)", () => {
    setLoadError(els, "boom");
    setLoadError(els, null);
    expect(els.loadError.hidden).toBe(true);
  });

  it("Retry control is present inside the load-error area (Section C)", () => {
    // The button should be inside loadError (or at minimum in the document).
    expect(els.loadErrorRetry.textContent).toContain("Retry");
    expect(els.loadError.contains(els.loadErrorRetry)).toBe(true);
  });
});

// P3 fix — explicit loadErrorDetail reference (brittle DOM-order selector).
describe("render: setLoadError uses the explicit loadErrorDetail element (P3)", () => {
  it("skeleton exposes loadErrorDetail as a named PanelElements field", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    expect(els.loadErrorDetail).toBeDefined();
    expect(els.loadErrorDetail.tagName).toBe("P");
    expect(els.loadErrorDetail.className).toBe("vidernu-load-error-detail");
  });

  it("setLoadError writes the detail text into loadErrorDetail, not the hint paragraph", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    setLoadError(els, "disk quota exceeded");
    // The named element carries the error text.
    expect(els.loadErrorDetail.textContent).toBe("disk quota exceeded");
    // The hint paragraph (vidernu-error-hint) is unaffected.
    const hint = els.loadError.querySelector(".vidernu-error-hint");
    expect(hint?.textContent).not.toContain("disk quota exceeded");
  });

  it("setLoadError(null) clears the detail text regardless of paragraph insertion order", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    setLoadError(els, "some error");
    setLoadError(els, null);
    // The named element is cleared directly — not via a positional querySelector("p").
    expect(els.loadErrorDetail.textContent).toBe("");
  });
});
