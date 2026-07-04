/**
 * Panel rendering (FR-5). Builds the four-section skeleton once and updates
 * it in place. Not a PURE module by the plan's definition (it's DOM-shape
 * shell code, covered by manual QA), but it takes no `chrome.*` dependency
 * itself — only plain DOM.
 */
import type { AnalysisResult } from "../shared/schema";

export interface PanelElements {
  root: HTMLElement;
  analyzeButton: HTMLButtonElement;
  captionHint: HTMLElement;
  modelState: HTMLElement;
  // Dedicated load-error area — shows the real error detail + hint + Retry (FR-4/FR-14).
  loadError: HTMLElement;
  loadErrorRetry: HTMLButtonElement;
  fallbackBanner: HTMLElement;
  advisoryBanner: HTMLElement;
  validationNote: HTMLElement;
  analyzedLine: HTMLElement;
  status: HTMLElement;
  sections: HTMLElement;
}

const NOT_AVAILABLE = "Not available.";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Builds the static panel skeleton once; subsequent updates mutate these nodes. */
export function renderSkeleton(container: HTMLElement): PanelElements {
  container.innerHTML = "";
  const root = el("div", "vidernu-panel");

  const header = el("div", "vidernu-header");
  header.appendChild(el("h1", "vidernu-title", "Vidernu"));
  const analyzeButton = el("button", "vidernu-analyze-btn", "Analyze current line");
  analyzeButton.type = "button";
  header.appendChild(analyzeButton);
  root.appendChild(header);

  const captionHint = el("div", "vidernu-caption-hint");
  root.appendChild(captionHint);

  const modelState = el("div", "vidernu-model-state");
  modelState.hidden = true;
  root.appendChild(modelState);

  // Dedicated load-error area — distinct from the generic modelState banner and
  // from the analysis-result error in sections (FR-4). Hidden until an error occurs.
  const loadError = el("div", "vidernu-load-error");
  loadError.hidden = true;
  const loadErrorDetail = el("p");
  loadError.appendChild(loadErrorDetail);
  loadError.appendChild(
    el("p", "vidernu-error-hint", "Try clicking Retry, or reload the extension if this persists."),
  );
  const loadErrorRetry = el("button", "vidernu-retry-btn", "Retry");
  loadErrorRetry.type = "button";
  loadError.appendChild(loadErrorRetry);
  root.appendChild(loadError);

  const fallbackBanner = el("div", "vidernu-banner vidernu-banner-error");
  fallbackBanner.hidden = true;
  root.appendChild(fallbackBanner);

  const advisoryBanner = el("div", "vidernu-banner vidernu-banner-warning");
  advisoryBanner.hidden = true;
  root.appendChild(advisoryBanner);

  const validationNote = el("div", "vidernu-banner vidernu-banner-info");
  validationNote.hidden = true;
  root.appendChild(validationNote);

  const analyzedLine = el("div", "vidernu-analyzed-line");
  analyzedLine.hidden = true;
  root.appendChild(analyzedLine);

  const status = el("div", "vidernu-status");
  status.hidden = true;
  root.appendChild(status);

  const sections = el("div", "vidernu-sections");
  root.appendChild(sections);

  container.appendChild(root);

  return {
    root,
    analyzeButton,
    captionHint,
    modelState,
    loadError,
    loadErrorRetry,
    fallbackBanner,
    advisoryBanner,
    validationNote,
    analyzedLine,
    status,
    sections,
  };
}

export function setModelState(els: PanelElements, message: string | null): void {
  setBanner(els.modelState, message);
}

/** Live, non-blocking hint of whether a caption is currently on screen (FR-3.12). */
export function setCaptionHint(els: PanelElements, present: boolean): void {
  els.captionHint.textContent = present
    ? "Captions detected — ready to analyze."
    : "No captions detected. Turn on captions to analyze a line.";
  els.captionHint.classList.toggle("vidernu-caption-hint-missing", !present);
}

function setBanner(banner: HTMLElement, message: string | null): void {
  if (!message) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}

export function setFallbackBanner(els: PanelElements, message: string | null): void {
  setBanner(els.fallbackBanner, message);
}

export function setAdvisoryBanner(els: PanelElements, message: string | null): void {
  setBanner(els.advisoryBanner, message);
}

export function setValidationNote(els: PanelElements, message: string | null): void {
  setBanner(els.validationNote, message);
}

export function setAnalyzeButtonState(
  els: PanelElements,
  options: { enabled: boolean; label?: string },
): void {
  els.analyzeButton.disabled = !options.enabled;
  if (options.label) els.analyzeButton.textContent = options.label;
}

function setAnalyzedLine(els: PanelElements, text: string | null, label = "Analyzing"): void {
  if (!text) {
    els.analyzedLine.hidden = true;
    els.analyzedLine.textContent = "";
    return;
  }
  els.analyzedLine.hidden = false;
  els.analyzedLine.textContent = `${label}: "${text}"`;
}

function setStatus(els: PanelElements, text: string | null): void {
  if (!text) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.textContent = text;
}

/** Shows a loading state for `analyzedLine` while an analysis is in progress (FR-20). */
export function renderLoading(els: PanelElements, analyzedLine: string): void {
  setAnalyzedLine(els, analyzedLine);
  setStatus(els, "Analyzing…");
  els.sections.innerHTML = "";
}

/** No analyzable caption text was found at trigger time (edge case). */
export function renderNoCaption(els: PanelElements): void {
  setAnalyzedLine(els, null);
  setStatus(els, "No caption text to analyze. Turn on captions and try again.");
  els.sections.innerHTML = "";
}

/** The content script could not read the caption DOM at all (YouTube DOM-change edge case). */
export function renderCaptureError(els: PanelElements): void {
  setAnalyzedLine(els, null);
  setStatus(els, "Couldn't read the current caption. Try again or reload the page.");
  els.sections.innerHTML = "";
}

/** FR-27 error object rendered as a readable, retryable state (FR-7.28). */
export function renderAnalysisError(
  els: PanelElements,
  analyzedLine: string,
  message: string,
): void {
  setAnalyzedLine(els, analyzedLine, "Analyzed");
  setStatus(els, null);
  els.sections.innerHTML = "";
  const errorBox = el("div", "vidernu-error");
  errorBox.appendChild(el("p", undefined, message));
  errorBox.appendChild(el("p", "vidernu-error-hint", "Click “Analyze current line” to retry."));
  els.sections.appendChild(errorBox);
}

function renderSection(title: string, body: HTMLElement): HTMLElement {
  const section = el("section", "vidernu-section");
  section.appendChild(el("h2", "vidernu-section-title", title));
  section.appendChild(body);
  return section;
}

function renderTranslationSection(result: AnalysisResult): HTMLElement {
  const body = el("div", "vidernu-translation");
  const literal = result.translation.literal.trim();
  const natural = result.translation.natural.trim();
  const literalRow = el("p");
  literalRow.appendChild(el("strong", undefined, "Literal: "));
  literalRow.appendChild(document.createTextNode(literal || NOT_AVAILABLE));
  const naturalRow = el("p");
  naturalRow.appendChild(el("strong", undefined, "Natural: "));
  naturalRow.appendChild(document.createTextNode(natural || NOT_AVAILABLE));
  body.appendChild(literalRow);
  body.appendChild(naturalRow);
  return renderSection("Translation", body);
}

function renderDeconstructionSection(result: AnalysisResult): HTMLElement {
  if (result.deconstruction.length === 0) {
    return renderSection("Deconstruction", el("p", "vidernu-empty", NOT_AVAILABLE));
  }
  const table = el("table", "vidernu-deconstruction-table");
  const head = el("tr");
  ["Token", "Root", "Part of speech", "Role / meaning"].forEach((label) => {
    head.appendChild(el("th", undefined, label));
  });
  table.appendChild(head);
  for (const row of result.deconstruction) {
    const tr = el("tr");
    tr.appendChild(el("td", "vidernu-source-text", row.token));
    tr.appendChild(el("td", "vidernu-source-text", row.root));
    tr.appendChild(el("td", undefined, row.part_of_speech));
    tr.appendChild(el("td", undefined, row.role_or_meaning));
    table.appendChild(tr);
  }
  return renderSection("Deconstruction", table);
}

function renderContextSection(result: AnalysisResult): HTMLElement {
  const text = result.context.trim();
  return renderSection("Context & Meaning", el("p", undefined, text || NOT_AVAILABLE));
}

function renderGrammarSection(result: AnalysisResult): HTMLElement {
  if (result.grammar_rules.length === 0) {
    return renderSection("Grammar Notes", el("p", "vidernu-empty", NOT_AVAILABLE));
  }
  const list = el("ul", "vidernu-grammar-list");
  for (const rule of result.grammar_rules) {
    list.appendChild(el("li", undefined, rule));
  }
  return renderSection("Grammar Notes", list);
}

/**
 * Shows or hides the dedicated load-error area (FR-4). Pass the single-line
 * error detail to show; pass null to hide and clear (FR-5).
 */
export function setLoadError(els: PanelElements, detail: string | null): void {
  if (!detail) {
    els.loadError.hidden = true;
    // Reset the detail text so it cannot leak into a later error render.
    const detailEl = els.loadError.querySelector("p");
    if (detailEl) detailEl.textContent = "";
    return;
  }
  const detailEl = els.loadError.querySelector("p");
  if (detailEl) detailEl.textContent = detail;
  els.loadError.hidden = false;
}

/** Renders the four FR-5.19 sections, degrading empty sections cleanly (FR-5.21). */
export function renderAnalysis(
  els: PanelElements,
  analyzedLine: string,
  result: AnalysisResult,
): void {
  setAnalyzedLine(els, analyzedLine, "Analyzed");
  setStatus(els, null);
  els.sections.innerHTML = "";
  els.sections.appendChild(renderTranslationSection(result));
  els.sections.appendChild(renderDeconstructionSection(result));
  els.sections.appendChild(renderContextSection(result));
  els.sections.appendChild(renderGrammarSection(result));
}
