import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INITIAL_PANEL_STATE,
  quickSucceeded,
  startDetail,
  startQuick,
} from "../src/sidepanel/panel-state";
import type { DetailResult, QuickResult } from "../src/shared/schema";
import {
  renderDeconstructionTokenCards,
  renderDetailTabs,
  renderPanel,
  renderSkeleton,
  renderTabs,
  renderTranslationTab,
  setLoadError,
  setStopControl,
  type PanelElements,
} from "../src/sidepanel/render";

const QUICK_RESULT: QuickResult = { translation: { literal: "lit", natural: "nat" } };
const DETAIL_RESULT: DetailResult = {
  deconstruction: [
    { token: "학교", root: "학교", part_of_speech: "noun", role_or_meaning: "school" },
  ],
  context: "ctx",
  grammar_rules: ["rule one"],
};

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

  it("setLoadError shows the error detail and a hint — distinct node from the tab panel (FR-4)", () => {
    setLoadError(els, "boom");
    expect(els.loadError.hidden).toBe(false);
    expect(els.loadError.textContent).toContain("boom");
    expect(els.loadError.textContent).toContain("Retry");
    expect(els.loadError).not.toBe(els.tabPanel);
  });

  it("setLoadError(null) hides the area and clears detail (FR-5)", () => {
    setLoadError(els, "boom");
    setLoadError(els, null);
    expect(els.loadError.hidden).toBe(true);
  });

  it("Retry control is present inside the load-error area (Section C)", () => {
    expect(els.loadErrorRetry.textContent).toContain("Retry");
    expect(els.loadError.contains(els.loadErrorRetry)).toBe(true);
  });
});

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
    expect(els.loadErrorDetail.textContent).toBe("disk quota exceeded");
    const hint = els.loadError.querySelector(".vidernu-error-hint");
    expect(hint?.textContent).not.toContain("disk quota exceeded");
  });

  it("setLoadError(null) clears the detail text regardless of paragraph insertion order", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    setLoadError(els, "some error");
    setLoadError(els, null);
    expect(els.loadErrorDetail.textContent).toBe("");
  });
});

describe("render: persistent Local · Private badge (FR-E8)", () => {
  it("is present in the skeleton, in every content state", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    expect(els.localBadge).toBeDefined();
    expect(els.localBadge.textContent).toContain("Local");
    expect(els.localBadge.textContent).toContain("Private");
    expect(els.localBadge.className).not.toMatch(/error|danger/);
  });
});

describe("render: tab strip (FR-E6)", () => {
  let els: PanelElements;

  beforeEach(() => {
    const container = document.createElement("div");
    els = renderSkeleton(container);
  });

  it("renders four tabs with aria-selected/aria-disabled from deriveTabStates", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);

    renderPanel(els, state, { onRetryQuick: () => {}, onRetryDetail: () => {} });

    expect(els.tabs.translation.getAttribute("aria-selected")).toBe("true");
    expect(els.tabs.translation.getAttribute("aria-disabled")).toBe("false");

    expect(els.tabs.deconstruction.getAttribute("aria-selected")).toBe("false");
    expect(els.tabs.deconstruction.getAttribute("aria-disabled")).toBe("true");
    expect(els.tabs.deconstruction.disabled).toBe(true);
  });

  it("unlocks the detail tabs once the detail phase completes", () => {
    let state = startQuick("hello");
    state = quickSucceeded(state, QUICK_RESULT);
    state = startDetail(state);
    renderPanel(els, state, { onRetryQuick: () => {}, onRetryDetail: () => {} });
    expect(els.tabs.deconstruction.getAttribute("aria-disabled")).toBe("false");
    expect(els.tabs.deconstruction.disabled).toBe(false);
  });

  it("renderTabs directly reflects the passed tabStates", () => {
    renderTabs(
      els,
      { translation: "active", deconstruction: "pending", context: "pending", grammar: "pending" },
      "translation",
    );
    expect(els.tabs.translation.getAttribute("aria-selected")).toBe("true");
    expect(els.tabs.grammar.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("render: deconstruction as token-cards, not a table (FR-E6)", () => {
  it("renders a token-card per row with token, root, part of speech, and meaning", () => {
    const grid = renderDeconstructionTokenCards(DETAIL_RESULT.deconstruction);
    expect(grid.querySelector("table")).toBeNull();
    expect(grid.querySelectorAll(".vidernu-token-card")).toHaveLength(1);
    expect(grid.querySelector(".vidernu-token-box")?.textContent).toContain("학교");
    expect(grid.textContent).toContain("noun");
    expect(grid.textContent).toContain("school");
  });

  it("degrades cleanly for an empty deconstruction (FR-5.21)", () => {
    const el = renderDeconstructionTokenCards([]);
    expect(el.classList.contains("vidernu-empty")).toBe(true);
  });
});

describe("render: renderTranslationTab (FR-E1/E3)", () => {
  it("shows a loading indicator while the quick phase generates", () => {
    const container = document.createElement("div");
    renderTranslationTab(container, { status: "loading" }, () => {});
    expect(container.querySelector(".vidernu-loading-inline")).not.toBeNull();
  });

  it("shows an inline error with a working Retry callback", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    renderTranslationTab(container, { status: "error", error: "boom" }, onRetry);
    expect(container.textContent).toContain("boom");
    const retryBtn = container.querySelector(".vidernu-retry-btn") as HTMLButtonElement;
    retryBtn.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the literal/natural translation on success", () => {
    const container = document.createElement("div");
    renderTranslationTab(container, { status: "done", result: QUICK_RESULT }, () => {});
    expect(container.textContent).toContain("lit");
    expect(container.textContent).toContain("nat");
  });
});

describe("render: renderDetailTabs (FR-E1/E3/E6)", () => {
  it("shows a locked/pending placeholder before Phase 2 starts", () => {
    const container = document.createElement("div");
    renderDetailTabs(container, "deconstruction", { status: "idle" }, () => {});
    expect(container.querySelector(".vidernu-pending-note")).not.toBeNull();
  });

  it("shows a loading indicator while generating", () => {
    const container = document.createElement("div");
    renderDetailTabs(container, "context", { status: "loading" }, () => {});
    expect(container.querySelector(".vidernu-loading-inline")).not.toBeNull();
  });

  it("shows an inline error with a working Retry callback", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    renderDetailTabs(container, "grammar", { status: "error", error: "boom" }, onRetry);
    expect(container.textContent).toContain("boom");
    (container.querySelector(".vidernu-retry-btn") as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders grammar rules as a list on success", () => {
    const container = document.createElement("div");
    renderDetailTabs(container, "grammar", { status: "done", result: DETAIL_RESULT }, () => {});
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.textContent).toContain("rule one");
  });

  it("renders context text on success", () => {
    const container = document.createElement("div");
    renderDetailTabs(container, "context", { status: "done", result: DETAIL_RESULT }, () => {});
    expect(container.textContent).toContain("ctx");
  });
});

describe("render: Stop control visibility (FR-C1/E2)", () => {
  it("is hidden when no phase is running", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    setStopControl(els, null);
    expect(els.stopButton.hidden).toBe(true);
  });

  it("is visible when a phase is running", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    setStopControl(els, "quick");
    expect(els.stopButton.hidden).toBe(false);
  });
});

describe("render: renderPanel end-to-end (FR-E4)", () => {
  it("shows the analyzed-line label and the detail trigger once quick succeeds", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    let state = startQuick("hello world");
    state = quickSucceeded(state, QUICK_RESULT);

    renderPanel(els, state, { onRetryQuick: () => {}, onRetryDetail: () => {} });

    expect(els.analyzedLine.textContent).toBe('Analyzed: "hello world"');
    expect(els.detailTrigger.hidden).toBe(false);
  });

  it("shows 'Analyzing' while the quick phase is in flight", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    const state = startQuick("hello world");

    renderPanel(els, state, { onRetryQuick: () => {}, onRetryDetail: () => {} });

    expect(els.analyzedLine.textContent).toBe('Analyzing: "hello world"');
    expect(els.stopButton.hidden).toBe(false);
  });

  it("hides the analyzed line and everything else on the initial idle state", () => {
    const container = document.createElement("div");
    const els = renderSkeleton(container);
    renderPanel(els, INITIAL_PANEL_STATE, { onRetryQuick: () => {}, onRetryDetail: () => {} });
    expect(els.analyzedLine.hidden).toBe(true);
    expect(els.detailTrigger.hidden).toBe(true);
    expect(els.stopButton.hidden).toBe(true);
  });
});
