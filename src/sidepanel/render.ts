/**
 * Panel rendering (FR-E). Builds the tab-based skeleton once and updates it
 * in place. Not a PURE module by the plan's definition (it's DOM-shape
 * shell code, covered by manual QA), but it takes no `chrome.*` dependency
 * itself — only plain DOM and the pure `panel-state` selectors.
 */
import {
  deriveTabStates,
  type PanelState,
  type PhaseState,
  runningPhase,
  showDetailTrigger,
  type TabId,
  type TabVisual,
} from "./panel-state";
import type { AnalysisPhase } from "../shared/messages";
import type { DeconstructionRow, DetailResult, QuickResult } from "../shared/schema";

export interface PanelElements {
  root: HTMLElement;
  localBadge: HTMLElement;
  analyzeButton: HTMLButtonElement;
  detailTrigger: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  captionHint: HTMLElement;
  modelState: HTMLElement;
  // Dedicated load-error area — shows the real error detail + hint + Retry (FR-4/FR-14).
  loadError: HTMLElement;
  // Explicit reference avoids brittle DOM-order querySelector("p") inside loadError.
  loadErrorDetail: HTMLElement;
  loadErrorRetry: HTMLButtonElement;
  fallbackBanner: HTMLElement;
  advisoryBanner: HTMLElement;
  validationNote: HTMLElement;
  analyzedLine: HTMLElement;
  status: HTMLElement;
  tabStrip: HTMLElement;
  tabs: Record<TabId, HTMLButtonElement>;
  tabPanel: HTMLElement;
}

export interface RenderCallbacks {
  onRetryQuick(): void;
  onRetryDetail(): void;
}

const NOT_AVAILABLE = "Not available.";

const TAB_ORDER: readonly TabId[] = ["translation", "deconstruction", "context", "grammar"];

const TAB_LABELS: Record<TabId, string> = {
  translation: "Translation",
  deconstruction: "Deconstruction",
  context: "Context & Meaning",
  grammar: "Grammar Notes",
};

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
  const headerTitles = el("div", "vidernu-header-titles");
  headerTitles.appendChild(el("h1", "vidernu-title", "Vidernu"));
  // Persistent local/private indicator (FR-E8) — present across all content states.
  const localBadge = el("span", "vidernu-badge-local", "Local · Private");
  headerTitles.appendChild(localBadge);
  header.appendChild(headerTitles);

  const headerActions = el("div", "vidernu-header-actions");
  const analyzeButton = el("button", "vidernu-analyze-btn", "Analyze current line");
  analyzeButton.type = "button";
  headerActions.appendChild(analyzeButton);

  const detailTrigger = el("button", "vidernu-detail-trigger-btn", "Show detailed breakdown");
  detailTrigger.type = "button";
  detailTrigger.hidden = true;
  headerActions.appendChild(detailTrigger);

  // Stop control (FR-C1/E2) — visible only while its phase is generating.
  const stopButton = el("button", "vidernu-stop-btn");
  stopButton.type = "button";
  const stopIcon = el("span", "vidernu-stop-icon");
  stopIcon.setAttribute("aria-hidden", "true");
  stopButton.appendChild(stopIcon);
  stopButton.appendChild(document.createTextNode("Stop"));
  stopButton.hidden = true;
  headerActions.appendChild(stopButton);

  header.appendChild(headerActions);
  root.appendChild(header);

  const captionHint = el("div", "vidernu-caption-hint");
  root.appendChild(captionHint);

  const modelState = el("div", "vidernu-model-state");
  modelState.hidden = true;
  root.appendChild(modelState);

  // Dedicated load-error area — distinct from the generic modelState banner and
  // from the per-phase analysis error in the tab panel (FR-4). Hidden until an error occurs.
  const loadError = el("div", "vidernu-load-error");
  loadError.hidden = true;
  const loadErrorDetail = el("p", "vidernu-load-error-detail");
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

  // Tab strip (FR-E6): role=tablist/tab/tabpanel, aria-selected/aria-disabled
  // exposed for assistive tech (accessibility NFR).
  const tabStrip = el("div", "vidernu-tablist");
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "Analysis sections");

  const tabPanel = el("div", "vidernu-tabpanel");
  tabPanel.id = "vidernu-tabpanel";
  tabPanel.setAttribute("role", "tabpanel");
  tabPanel.setAttribute("aria-live", "polite");
  tabPanel.tabIndex = 0;

  const tabs = {} as Record<TabId, HTMLButtonElement>;
  for (const tabId of TAB_ORDER) {
    const tab = el("button", "vidernu-tab");
    tab.type = "button";
    tab.id = `vidernu-tab-${tabId}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", tabPanel.id);
    tab.setAttribute("aria-selected", "false");
    tabStrip.appendChild(tab);
    tabs[tabId] = tab;
  }

  root.appendChild(tabStrip);
  root.appendChild(tabPanel);

  container.appendChild(root);

  return {
    root,
    localBadge,
    analyzeButton,
    detailTrigger,
    stopButton,
    captionHint,
    modelState,
    loadError,
    loadErrorDetail,
    loadErrorRetry,
    fallbackBanner,
    advisoryBanner,
    validationNote,
    analyzedLine,
    status,
    tabStrip,
    tabs,
    tabPanel,
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

function setStatus(els: PanelElements, text: string | null): void {
  if (!text) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.textContent = text;
}

/** No analyzable caption text was found at trigger time (edge case). */
export function renderNoCaption(els: PanelElements): void {
  setStatus(els, "No caption text to analyze. Turn on captions and try again.");
}

/** The content script could not read the caption DOM at all (YouTube DOM-change edge case). */
export function renderCaptureError(els: PanelElements): void {
  setStatus(els, "Couldn't read the current caption. Try again or reload the page.");
}

/**
 * Shows or hides the dedicated load-error area (FR-4). Pass the single-line
 * error detail to show; pass null to hide and clear (FR-5).
 */
export function setLoadError(els: PanelElements, detail: string | null): void {
  if (!detail) {
    els.loadError.hidden = true;
    // Reset the detail text so it cannot leak into a later error render.
    els.loadErrorDetail.textContent = "";
    return;
  }
  els.loadErrorDetail.textContent = detail;
  els.loadError.hidden = false;
}

/** Shows or hides the "Show detailed breakdown" trigger (FR-A3/A5). */
export function setDetailTrigger(els: PanelElements, visible: boolean): void {
  els.detailTrigger.hidden = !visible;
}

/** Shows the Stop control only while `phase` is generating (FR-C1/E2); hidden when null. */
export function setStopControl(els: PanelElements, phase: AnalysisPhase | null): void {
  els.stopButton.hidden = phase === null;
}

/**
 * Renders each tab's `aria-selected`/`aria-disabled`/visual class from
 * `deriveTabStates` (FR-E6). Pending/locked tabs are disabled so they
 * cannot be activated by click or keyboard.
 */
export function renderTabs(
  els: PanelElements,
  tabStates: Record<TabId, TabVisual>,
  activeTab: TabId,
): void {
  for (const tabId of TAB_ORDER) {
    const tab = els.tabs[tabId];
    const visual = tabStates[tabId];
    const isPending = visual === "pending";

    tab.classList.remove("vidernu-tab-pending", "vidernu-tab-loading", "vidernu-tab-error");
    if (visual === "pending") tab.classList.add("vidernu-tab-pending");
    if (visual === "loading") tab.classList.add("vidernu-tab-loading");
    if (visual === "error") tab.classList.add("vidernu-tab-error");

    tab.setAttribute("aria-selected", String(activeTab === tabId && visual === "active"));
    tab.setAttribute("aria-disabled", String(isPending));
    tab.disabled = isPending;

    tab.textContent = "";
    if (isPending) {
      const lock = el("span", "vidernu-tab-lock-icon", "🔒");
      lock.setAttribute("aria-hidden", "true");
      tab.appendChild(lock);
    }
    tab.appendChild(document.createTextNode(TAB_LABELS[tabId]));
  }
}

function renderLoadingIndicator(label: string): HTMLElement {
  const wrap = el("div", "vidernu-loading-inline");
  const spinner = el("span", "vidernu-spinner");
  spinner.setAttribute("aria-hidden", "true");
  wrap.appendChild(spinner);
  wrap.appendChild(document.createTextNode(label));
  return wrap;
}

/** Inline error + Retry (FR-D3/E3) — never blanks or disrupts the rest of the panel. */
function renderInlineError(message: string, onRetry: () => void): HTMLElement {
  const box = el("div", "vidernu-error");
  box.appendChild(el("p", undefined, message));
  const retryBtn = el("button", "vidernu-retry-btn", "Retry");
  retryBtn.type = "button";
  retryBtn.addEventListener("click", onRetry);
  box.appendChild(retryBtn);
  return box;
}

function renderTranslationBody(result: QuickResult): HTMLElement {
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
  return body;
}

/**
 * Renders the Translation tab's content confined to `container` — loading
 * spinner / inline error+Retry / result — without touching the rest of the
 * panel (FR-E1/E3).
 */
export function renderTranslationTab(
  container: HTMLElement,
  quick: PhaseState<QuickResult>,
  onRetry: () => void,
): void {
  container.innerHTML = "";
  container.appendChild(el("h3", "vidernu-tab-heading", "Translation"));

  if (quick.status === "loading") {
    container.appendChild(renderLoadingIndicator("Translating…"));
    return;
  }
  if (quick.status === "error") {
    container.appendChild(renderInlineError(quick.error ?? "Something went wrong.", onRetry));
    return;
  }
  if (quick.status === "idle" || !quick.result) {
    container.appendChild(el("p", "vidernu-empty", "Click “Analyze current line” to get started."));
    return;
  }
  container.appendChild(renderTranslationBody(quick.result));
}

/** Renders deconstruction rows as individual token-cards (FR-E6) — not a plain table/list. */
export function renderDeconstructionTokenCards(rows: DeconstructionRow[]): HTMLElement {
  if (rows.length === 0) {
    return el("p", "vidernu-empty", NOT_AVAILABLE);
  }
  const grid = el("div", "vidernu-token-grid");
  for (const row of rows) {
    const card = el("div", "vidernu-token-card");

    const tokenBox = el("div", "vidernu-token-box", row.token);
    if (row.root && row.root !== row.token) {
      tokenBox.appendChild(el("span", "vidernu-token-root", row.root));
    }
    card.appendChild(tokenBox);

    const bodyEl = el("div", "vidernu-token-body");
    bodyEl.appendChild(el("span", "vidernu-token-pos", row.part_of_speech || NOT_AVAILABLE));
    bodyEl.appendChild(el("p", "vidernu-token-meaning", row.role_or_meaning || NOT_AVAILABLE));
    card.appendChild(bodyEl);

    grid.appendChild(card);
  }
  return grid;
}

function renderContextBody(context: string): HTMLElement {
  const text = context.trim();
  return el("div", "vidernu-context-body", text || NOT_AVAILABLE);
}

function renderGrammarList(rules: string[]): HTMLElement {
  if (rules.length === 0) {
    return el("p", "vidernu-empty", NOT_AVAILABLE);
  }
  const list = el("ul", "vidernu-grammar-list");
  for (const rule of rules) {
    list.appendChild(el("li", undefined, rule));
  }
  return list;
}

/**
 * Renders whichever detail tab (`deconstruction` | `context` | `grammar`)
 * is active, confined to `container` (FR-E1/E3): locked/pending placeholder
 * before Phase 2 starts, loading spinner while generating, inline
 * error+Retry on failure, or the populated section on success.
 */
export function renderDetailTabs(
  container: HTMLElement,
  activeTab: Exclude<TabId, "translation">,
  detail: PhaseState<DetailResult>,
  onRetry: () => void,
): void {
  container.innerHTML = "";
  container.appendChild(el("h3", "vidernu-tab-heading", TAB_LABELS[activeTab]));

  if (detail.status === "idle") {
    container.appendChild(
      el("p", "vidernu-pending-note", "Click “Show detailed breakdown” to generate this section."),
    );
    return;
  }
  if (detail.status === "loading") {
    container.appendChild(renderLoadingIndicator("Generating…"));
    return;
  }
  if (detail.status === "error") {
    container.appendChild(renderInlineError(detail.error ?? "Something went wrong.", onRetry));
    return;
  }
  if (!detail.result) return; // defensive: "done" without a result should not occur

  if (activeTab === "deconstruction") {
    container.appendChild(renderDeconstructionTokenCards(detail.result.deconstruction));
  } else if (activeTab === "context") {
    container.appendChild(renderContextBody(detail.result.context));
  } else {
    container.appendChild(renderGrammarList(detail.result.grammar_rules));
  }
}

function renderTabPanel(els: PanelElements, state: PanelState, callbacks: RenderCallbacks): void {
  if (state.activeTab === "translation") {
    renderTranslationTab(els.tabPanel, state.quick, callbacks.onRetryQuick);
    return;
  }
  renderDetailTabs(els.tabPanel, state.activeTab, state.detail, callbacks.onRetryDetail);
}

function setAnalyzedLine(els: PanelElements, state: PanelState): void {
  if (!state.line) {
    els.analyzedLine.hidden = true;
    els.analyzedLine.textContent = "";
    return;
  }
  const label = state.quick.status === "loading" ? "Analyzing" : "Analyzed";
  els.analyzedLine.hidden = false;
  els.analyzedLine.textContent = `${label}: "${state.line}"`;
}

/**
 * The single entry point main.ts calls after every panel-state transition
 * (FR-E4: one source of truth, no full-panel blocking spinner). Composes
 * the granular render functions above.
 */
export function renderPanel(
  els: PanelElements,
  state: PanelState,
  callbacks: RenderCallbacks,
): void {
  // Any real panel-state render supersedes an earlier pre-analysis status
  // message (e.g. "no caption detected") — FR-E4 clear content-state model.
  setStatus(els, null);
  setAnalyzedLine(els, state);

  const tabStates = deriveTabStates(state);
  renderTabs(els, tabStates, state.activeTab);
  els.tabPanel.setAttribute("aria-label", TAB_LABELS[state.activeTab]);
  renderTabPanel(els, state, callbacks);

  setDetailTrigger(els, showDetailTrigger(state));
  setStopControl(els, runningPhase(state));
}
