/**
 * The two-phase panel view model and its pure derivations (FR-A, FR-C4,
 * FR-D, FR-E4, FR-E6). PURE — no `chrome.*` or DOM references — so the
 * whole state machine is unit-testable in isolation (spec Testability NFR).
 *
 * `main.ts` owns the mutable `state` variable and the `chrome.runtime`
 * wiring; it calls these transition helpers to produce the next state, then
 * hands the result (plus the selectors below) to `render.ts`.
 */
import type { AnalysisPhase } from "../shared/messages";
import type { DetailResult, QuickResult } from "../shared/schema";

export type PhaseStatus = "idle" | "loading" | "done" | "error";

export type TabId = "translation" | "deconstruction" | "context" | "grammar";

export type TabVisual = "active" | "available" | "pending" | "loading" | "error";

export interface PhaseState<R> {
  status: PhaseStatus;
  result?: R;
  error?: string;
}

export interface PanelState {
  /** The captured source line both phases analyze (FR-A4). Null before the first analysis. */
  line: string | null;
  lang?: string;
  quick: PhaseState<QuickResult>;
  detail: PhaseState<DetailResult>;
  activeTab: TabId;
}

const DETAIL_TABS: readonly TabId[] = ["deconstruction", "context", "grammar"];

/** The panel's initial "ready to analyze" state, and the target of `stopQuick` (FR-C4). */
export const INITIAL_PANEL_STATE: PanelState = {
  line: null,
  lang: undefined,
  quick: { status: "idle" },
  detail: { status: "idle" },
  activeTab: "translation",
};

// --- Transitions -----------------------------------------------------------

/**
 * A fresh "Analyze current line" (FR-A1). Wipes any prior quick/detail
 * result — a new analysis supersedes the whole panel (FR-A8, the accepted
 * assumption that a fresh analyze replaces all tabs).
 */
export function startQuick(line: string, lang?: string): PanelState {
  return {
    line,
    lang,
    quick: { status: "loading" },
    detail: { status: "idle" },
    activeTab: "translation",
  };
}

export function quickSucceeded(state: PanelState, result: QuickResult): PanelState {
  return { ...state, quick: { status: "done", result } };
}

export function quickFailed(state: PanelState, message: string): PanelState {
  return { ...state, quick: { status: "error", error: message } };
}

/**
 * "Show detailed breakdown" (FR-A3). No-op if detail is already loading —
 * guards against a double-fire spawning a duplicate generation (edge case).
 */
export function startDetail(state: PanelState): PanelState {
  if (state.detail.status === "loading") return state;
  return { ...state, detail: { status: "loading" } };
}

export function detailSucceeded(state: PanelState, result: DetailResult): PanelState {
  return { ...state, detail: { status: "done", result } };
}

export function detailFailed(state: PanelState, message: string): PanelState {
  return { ...state, detail: { status: "error", error: message } };
}

/**
 * Stopping the quick phase returns to a fresh "ready to analyze" state: no
 * quick or detail result, no lingering in-progress indicator (FR-C4).
 */
export function stopQuick(_state: PanelState): PanelState {
  return { ...INITIAL_PANEL_STATE };
}

/**
 * Stopping the detail phase leaves the quick translation intact and returns
 * detail to idle — not a spinner, not a half-result (FR-C4).
 */
export function stopDetail(state: PanelState): PanelState {
  return { ...state, detail: { status: "idle" } };
}

/**
 * Retry re-runs only the quick phase (FR-D2/D4). No-op if already loading
 * (double-press guard, edge case).
 */
export function retryQuick(state: PanelState): PanelState {
  if (state.quick.status === "loading") return state;
  return { ...state, quick: { status: "loading" } };
}

/**
 * Retry re-runs only the detail phase, leaving the quick result untouched
 * (FR-D2/D4). No-op if already loading (double-press guard, edge case).
 */
export function retryDetail(state: PanelState): PanelState {
  if (state.detail.status === "loading") return state;
  return { ...state, detail: { status: "loading" } };
}

export function setActiveTab(state: PanelState, tab: TabId): PanelState {
  return { ...state, activeTab: tab };
}

// --- Selectors ---------------------------------------------------------

function detailTabVisual(status: PhaseStatus): TabVisual {
  switch (status) {
    case "idle":
      return "pending";
    case "loading":
      return "loading";
    case "error":
      return "error";
    case "done":
      return "available";
  }
}

/**
 * Derives each tab's visual state for the tab strip (FR-E6). The
 * Translation tab reflects the quick phase; the three detail tabs share the
 * detail phase's status and are `pending` (locked) until it completes, at
 * which point they populate together. A tab is never `active` while
 * `pending` — the locked detail tabs cannot be the active tab.
 */
export function deriveTabStates(state: PanelState): Record<TabId, TabVisual> {
  const quickVisual: TabVisual =
    state.quick.status === "error"
      ? "error"
      : state.quick.status === "loading"
        ? "loading"
        : "available";
  const detailVisual = detailTabVisual(state.detail.status);

  const result = {
    translation: state.activeTab === "translation" ? "active" : quickVisual,
  } as Record<TabId, TabVisual>;

  for (const tab of DETAIL_TABS) {
    result[tab] = state.activeTab === tab && detailVisual !== "pending" ? "active" : detailVisual;
  }

  return result;
}

/** The "Show detailed breakdown" trigger is offered only after a successful quick result and before detail has started (FR-A5). */
export function showDetailTrigger(state: PanelState): boolean {
  return state.quick.status === "done" && state.detail.status === "idle";
}

/** Which phase is currently generating, if any — drives Stop visibility/target (FR-C1/C2). */
export function runningPhase(state: PanelState): AnalysisPhase | null {
  if (state.quick.status === "loading") return "quick";
  if (state.detail.status === "loading") return "detail";
  return null;
}

/** Which phase is in an error state, if any — drives inline Retry placement (FR-D3). */
export function retryPhase(state: PanelState): AnalysisPhase | null {
  if (state.quick.status === "error") return "quick";
  if (state.detail.status === "error") return "detail";
  return null;
}
