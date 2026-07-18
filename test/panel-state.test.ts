import { describe, expect, it } from "vitest";

import {
  deriveTabStates,
  detailFailed,
  detailSucceeded,
  INITIAL_PANEL_STATE,
  type PanelState,
  quickFailed,
  quickSucceeded,
  retryDetail,
  retryPhase,
  retryQuick,
  runningPhase,
  setActiveTab,
  showDetailTrigger,
  startDetail,
  startQuick,
  stopDetail,
  stopQuick,
} from "../src/sidepanel/panel-state";

const QUICK_RESULT = { translation: { literal: "lit", natural: "nat" } };
const DETAIL_RESULT = { deconstruction: [], context: "ctx", grammar_rules: [] };

describe("panel-state: full happy-path state machine", () => {
  it("idle -> quick-loading -> quick-done (detail locked) -> detail-loading -> detail-done", () => {
    let state: PanelState = INITIAL_PANEL_STATE;
    expect(state.quick.status).toBe("idle");
    expect(state.detail.status).toBe("idle");
    expect(deriveTabStates(state).deconstruction).toBe("pending");

    state = startQuick("hello", "ko");
    expect(state.quick.status).toBe("loading");
    expect(state.line).toBe("hello");
    expect(state.lang).toBe("ko");
    expect(runningPhase(state)).toBe("quick");
    expect(showDetailTrigger(state)).toBe(false);

    state = quickSucceeded(state, QUICK_RESULT);
    expect(state.quick.status).toBe("done");
    expect(state.quick.result).toEqual(QUICK_RESULT);
    expect(showDetailTrigger(state)).toBe(true);
    expect(runningPhase(state)).toBeNull();
    const tabsAfterQuick = deriveTabStates(state);
    expect(tabsAfterQuick.translation).toBe("active");
    expect(tabsAfterQuick.deconstruction).toBe("pending");
    expect(tabsAfterQuick.context).toBe("pending");
    expect(tabsAfterQuick.grammar).toBe("pending");

    state = startDetail(state);
    expect(state.detail.status).toBe("loading");
    expect(showDetailTrigger(state)).toBe(false);
    expect(runningPhase(state)).toBe("detail");
    const tabsWhileDetailLoading = deriveTabStates(state);
    expect(tabsWhileDetailLoading.deconstruction).toBe("loading");
    expect(tabsWhileDetailLoading.context).toBe("loading");
    expect(tabsWhileDetailLoading.grammar).toBe("loading");
    // Quick result is untouched while detail generates (FR-E1).
    expect(state.quick.result).toEqual(QUICK_RESULT);

    state = detailSucceeded(state, DETAIL_RESULT);
    expect(state.detail.status).toBe("done");
    expect(state.detail.result).toEqual(DETAIL_RESULT);
    const tabsAfterDetail = deriveTabStates(state);
    expect(tabsAfterDetail.deconstruction).toBe("available");
    expect(tabsAfterDetail.context).toBe("available");
    expect(tabsAfterDetail.grammar).toBe("available");
  });
});

describe("panel-state: quick-error offers retry and no detail trigger (FR-A5)", () => {
  it("quickFailed sets error status, retryPhase = quick, no detail trigger", () => {
    let state = startQuick("hello");
    state = quickFailed(state, "boom");
    expect(state.quick.status).toBe("error");
    expect(state.quick.error).toBe("boom");
    expect(retryPhase(state)).toBe("quick");
    expect(showDetailTrigger(state)).toBe(false);
    expect(deriveTabStates(state).translation).toBe("active");
    expect(deriveTabStates(state).deconstruction).toBe("pending");
  });
});

describe("panel-state: detail-error keeps quick result and shows detail-only retry (FR-D2)", () => {
  it("detailFailed leaves quick.result untouched", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    state = detailFailed(state, "timed out");
    expect(state.detail.status).toBe("error");
    expect(state.detail.error).toBe("timed out");
    expect(state.quick.status).toBe("done");
    expect(state.quick.result).toEqual(QUICK_RESULT);
    expect(retryPhase(state)).toBe("detail");
    const tabs = deriveTabStates(state);
    expect(tabs.deconstruction).toBe("error");
    expect(tabs.context).toBe("error");
    expect(tabs.grammar).toBe("error");
  });
});

describe("panel-state: stop transitions (FR-C4)", () => {
  it("stopDetail preserves the quick result and resets detail to idle", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    state = stopDetail(state);
    expect(state.detail.status).toBe("idle");
    expect(state.detail.result).toBeUndefined();
    expect(state.detail.error).toBeUndefined();
    expect(state.quick.status).toBe("done");
    expect(state.quick.result).toEqual(QUICK_RESULT);
    expect(showDetailTrigger(state)).toBe(true);
    expect(runningPhase(state)).toBeNull();
  });

  it("stopQuick resets to a fresh 'ready to analyze' state", () => {
    let state = startQuick("hello", "ko");
    state = stopQuick(state);
    expect(state).toEqual(INITIAL_PANEL_STATE);
    expect(state.line).toBeNull();
    expect(runningPhase(state)).toBeNull();
  });

  it("stopQuick after a quick success also wipes it (no partial result lingers)", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = stopQuick(state);
    expect(state).toEqual(INITIAL_PANEL_STATE);
  });
});

describe("panel-state: startQuick wipes prior detail (FR-A8)", () => {
  it("a fresh analyze while a detail result is shown clears both phases", () => {
    let state = startQuick("first line");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    state = detailSucceeded(state, DETAIL_RESULT);
    expect(state.detail.status).toBe("done"); // sanity check before the fresh analyze wipes it

    state = startQuick("second line");
    expect(state.line).toBe("second line");
    expect(state.quick.status).toBe("loading");
    expect(state.quick.result).toBeUndefined();
    expect(state.detail.status).toBe("idle");
    expect(state.detail.result).toBeUndefined();
    expect(state.activeTab).toBe("translation");
  });
});

describe("panel-state: deriveTabStates never marks a pending tab active", () => {
  it("setActiveTab to a still-pending detail tab does not surface as active", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    // Even if something forced activeTab onto a still-pending tab, it must
    // not report as "active" — pending/locked tabs are never active.
    state = setActiveTab(state, "deconstruction");
    const tabs = deriveTabStates(state);
    expect(tabs.deconstruction).toBe("pending");
  });

  it("setActiveTab to an available detail tab does surface as active", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    state = detailSucceeded(state, DETAIL_RESULT);
    state = setActiveTab(state, "grammar");
    const tabs = deriveTabStates(state);
    expect(tabs.grammar).toBe("active");
    expect(tabs.deconstruction).toBe("available");
    expect(tabs.translation).toBe("available");
  });
});

describe("panel-state: runningPhase/retryPhase/showDetailTrigger across states", () => {
  it("idle state: nothing running, nothing to retry, no detail trigger", () => {
    expect(runningPhase(INITIAL_PANEL_STATE)).toBeNull();
    expect(retryPhase(INITIAL_PANEL_STATE)).toBeNull();
    expect(showDetailTrigger(INITIAL_PANEL_STATE)).toBe(false);
  });

  it("quick loading: runningPhase quick, no retry, no detail trigger", () => {
    const state = startQuick("hello");
    expect(runningPhase(state)).toBe("quick");
    expect(retryPhase(state)).toBeNull();
    expect(showDetailTrigger(state)).toBe(false);
  });

  it("quick done: no running phase, no retry, detail trigger offered", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    expect(runningPhase(state)).toBeNull();
    expect(retryPhase(state)).toBeNull();
    expect(showDetailTrigger(state)).toBe(true);
  });

  it("detail loading: runningPhase detail, no retry, no detail trigger", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    expect(runningPhase(state)).toBe("detail");
    expect(retryPhase(state)).toBeNull();
    expect(showDetailTrigger(state)).toBe(false);
  });

  it("detail error: retryPhase detail, no running phase, no detail trigger", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    state = detailFailed(state, "boom");
    expect(runningPhase(state)).toBeNull();
    expect(retryPhase(state)).toBe("detail");
    expect(showDetailTrigger(state)).toBe(false);
  });
});

describe("panel-state: double-retry is a no-op while already loading (edge case)", () => {
  it("retryQuick while quick is loading does not spawn a second loading transition", () => {
    const state = startQuick("hello");
    const retried = retryQuick(state);
    expect(retried).toBe(state); // identical reference: true no-op
  });

  it("retryDetail while detail is loading does not spawn a second loading transition", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    const retried = retryDetail(state);
    expect(retried).toBe(state);
  });

  it("retryQuick from an error state clears the error and starts loading", () => {
    let state = startQuick("hello");
    state = quickFailed(state, "boom");
    state = retryQuick(state);
    expect(state.quick.status).toBe("loading");
    expect(state.quick.error).toBeUndefined();
  });

  it("retryDetail from an error state clears the error and starts loading, quick untouched", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    state = detailFailed(state, "boom");
    state = retryDetail(state);
    expect(state.detail.status).toBe("loading");
    expect(state.detail.error).toBeUndefined();
    expect(state.quick.result).toEqual(QUICK_RESULT);
  });

  it("startDetail while detail is already loading does not spawn a duplicate", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    const again = startDetail(state);
    expect(again).toBe(state);
  });
});
