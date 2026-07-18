/**
 * Unit tests for mountPanel message-handling logic (P3 fixes).
 *
 * These tests focus on the interaction between MODEL_STATUS and CAPABILITY
 * messages while the panel is in the "error" state, verifying that a
 * capability-only update does not inadvertently clear the visible error detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountPanel } from "../src/sidepanel/main";

type OnMessageListener = (message: unknown) => void;

/** Minimal chrome stub that captures the onMessage listener and exposes helpers. */
function installChromeMock() {
  let onMessageListener: OnMessageListener | undefined;
  const sendMessage = vi.fn((_msg: unknown, cb?: (response: unknown) => void) => {
    if (cb) cb(undefined); // no snapshot on the other end
  });

  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: vi.fn((fn: OnMessageListener) => {
          onMessageListener = fn;
        }),
        removeListener: vi.fn(),
      },
      sendMessage,
      lastError: undefined,
    },
  } as unknown as typeof chrome);

  return {
    sendMessage,
    /** Fire an incoming extension message at the panel's listener. */
    fire(msg: unknown): void {
      onMessageListener?.(msg);
    },
  };
}

/** Marks the model ready so the Analyze click handler's own guards are moot. */
function markReady(chrome: ReturnType<typeof installChromeMock>): void {
  chrome.fire({ type: "MODEL_STATUS", status: "ready" });
}

describe("mountPanel: CAPABILITY message while status is error (P3)", () => {
  let container: HTMLElement;
  let shadow: ShadowRoot;
  let chrome: ReturnType<typeof installChromeMock>;

  beforeEach(() => {
    container = document.createElement("div");
    // Provide a minimal shadow root host so mountPanel can append a <style>.
    const host = document.createElement("div");
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(container);

    chrome = installChromeMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("a CAPABILITY message does not clear the load-error detail when status is error", () => {
    const handle = mountPanel(shadow, container, () => ({ present: false, text: "" }));

    // Transition to error state with a real error detail.
    chrome.fire({ type: "MODEL_STATUS", status: "error", message: "GPU out of memory" });

    // Read straight from the DOM that mountPanel produced.
    const loadErrorEl = container.querySelector(".vidernu-load-error") as HTMLElement;
    const detailEl = container.querySelector(".vidernu-load-error-detail") as HTMLElement;
    expect(loadErrorEl.hidden).toBe(false);
    expect(detailEl.textContent).toBe("GPU out of memory");

    // Now fire a capability-only update (e.g. offscreen re-broadcasts adapter info).
    chrome.fire({ type: "CAPABILITY", webgpu: true, lowPowerHint: false });

    // The error area must still be visible with the same detail text.
    expect(loadErrorEl.hidden).toBe(false);
    expect(detailEl.textContent).toBe("GPU out of memory");

    handle.destroy();
  });

  it("error stays visible after Retry (LOAD_MODEL sent) until a real STATUS arrives", () => {
    const handle = mountPanel(shadow, container, () => ({ present: false, text: "" }));

    chrome.fire({ type: "MODEL_STATUS", status: "error", message: "timeout" });

    const loadErrorEl = container.querySelector(".vidernu-load-error") as HTMLElement;
    const detailEl = container.querySelector(".vidernu-load-error-detail") as HTMLElement;

    // Click Retry — this sends LOAD_MODEL; the status has not changed yet.
    const retryBtn = container.querySelector(".vidernu-retry-btn") as HTMLButtonElement;
    retryBtn.click();

    // Error must remain until a real new status (e.g. "downloading") arrives.
    expect(loadErrorEl.hidden).toBe(false);
    expect(detailEl.textContent).toBe("timeout");

    // A real status transition finally clears the error.
    chrome.fire({ type: "MODEL_STATUS", status: "downloading", progress: 0 });
    expect(loadErrorEl.hidden).toBe(true);

    handle.destroy();
  });

  it("a real MODEL_STATUS error message replaces the previous error detail", () => {
    const handle = mountPanel(shadow, container, () => ({ present: false, text: "" }));

    chrome.fire({ type: "MODEL_STATUS", status: "error", message: "first error" });
    chrome.fire({ type: "MODEL_STATUS", status: "error", message: "second error" });

    const detailEl = container.querySelector(".vidernu-load-error-detail") as HTMLElement;
    expect(detailEl.textContent).toBe("second error");

    handle.destroy();
  });
});

describe("mountPanel: two-phase analysis flow (FR-A/C/D)", () => {
  let container: HTMLElement;
  let shadow: ShadowRoot;
  let chrome: ReturnType<typeof installChromeMock>;

  beforeEach(() => {
    container = document.createElement("div");
    const host = document.createElement("div");
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(container);
    chrome = installChromeMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function clickAnalyze(): void {
    (container.querySelector(".vidernu-analyze-btn") as HTMLButtonElement).click();
  }

  it("paints the idle 'ready to analyze' state immediately on mount, before any action", () => {
    // Regression test: mountPanel used to never call render() until the first
    // state-changing event, so the tab strip had no labels/aria state and the
    // tab panel was empty right after the panel was injected — a real-DOM-only
    // bug (jsdom's `.hidden` assertions never caught it; confirmed broken via
    // a Playwright/Chromium load of the built extension).
    const handle = mountPanel(shadow, container, () => ({ present: true, text: "hello" }));

    const translationTab = container.querySelector("#vidernu-tab-translation") as HTMLButtonElement;
    expect(translationTab.textContent).toContain("Translation");
    expect(translationTab.getAttribute("aria-selected")).toBe("true");

    const deconstructionTab = container.querySelector(
      "#vidernu-tab-deconstruction",
    ) as HTMLButtonElement;
    expect(deconstructionTab.textContent).toContain("Deconstruction");
    expect(deconstructionTab.getAttribute("aria-disabled")).toBe("true");

    const tabPanel = container.querySelector("#vidernu-tabpanel") as HTMLElement;
    expect(tabPanel.textContent).toContain("Click");

    const stopButton = container.querySelector(".vidernu-stop-btn") as HTMLButtonElement;
    expect(stopButton.hidden).toBe(true);
    const detailTrigger = container.querySelector(
      ".vidernu-detail-trigger-btn",
    ) as HTMLButtonElement;
    expect(detailTrigger.hidden).toBe(true);

    handle.destroy();
  });

  function lastAnalyzeRequestId(phase: "quick" | "detail"): number {
    const calls = chrome.sendMessage.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m.type === "ANALYZE_REQUEST" && m.phase === phase);
    return calls.at(-1)!.requestId as number;
  }

  it("a successful quick ANALYSIS_RESULT renders the Translation tab and reveals the detail trigger", () => {
    const handle = mountPanel(shadow, container, () => ({
      present: true,
      text: "hello",
      lang: "ko",
    }));
    markReady(chrome);
    clickAnalyze();

    const requestId = lastAnalyzeRequestId("quick");
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId,
      phase: "quick",
      analyzedLine: "hello",
      result: { translation: { literal: "lit", natural: "nat" } },
    });

    const tabPanel = container.querySelector("#vidernu-tabpanel") as HTMLElement;
    expect(tabPanel.textContent).toContain("lit");
    expect(tabPanel.textContent).toContain("nat");
    const detailTrigger = container.querySelector(
      ".vidernu-detail-trigger-btn",
    ) as HTMLButtonElement;
    expect(detailTrigger.hidden).toBe(false);

    handle.destroy();
  });

  it("a detail result with a stale id is dropped", () => {
    const handle = mountPanel(shadow, container, () => ({
      present: true,
      text: "hello",
      lang: "ko",
    }));
    markReady(chrome);
    clickAnalyze();
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: lastAnalyzeRequestId("quick"),
      phase: "quick",
      analyzedLine: "hello",
      result: { translation: { literal: "lit", natural: "nat" } },
    });

    (container.querySelector(".vidernu-detail-trigger-btn") as HTMLButtonElement).click();
    const staleId = lastAnalyzeRequestId("detail") - 1; // an id that is not the latest

    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: staleId,
      phase: "detail",
      analyzedLine: "hello",
      result: { deconstruction: [], context: "should not render", grammar_rules: [] },
    });

    (container.querySelector("#vidernu-tab-context") as HTMLButtonElement).click();
    const tabPanel = container.querySelector("#vidernu-tabpanel") as HTMLElement;
    expect(tabPanel.textContent).not.toContain("should not render");

    handle.destroy();
  });

  it("a fresh Analyze while detail is pending drops a late detail result (FR-A8)", () => {
    const handle = mountPanel(shadow, container, () => ({
      present: true,
      text: "line one",
      lang: "ko",
    }));
    markReady(chrome);
    clickAnalyze();
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: lastAnalyzeRequestId("quick"),
      phase: "quick",
      analyzedLine: "line one",
      result: { translation: { literal: "l1", natural: "n1" } },
    });
    (container.querySelector(".vidernu-detail-trigger-btn") as HTMLButtonElement).click();
    const oldDetailId = lastAnalyzeRequestId("detail");

    // A new analyze starts for a different line while the detail phase for
    // the old line is still in flight.
    clickAnalyze();
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: lastAnalyzeRequestId("quick"),
      phase: "quick",
      analyzedLine: "line one",
      result: { translation: { literal: "l2", natural: "n2" } },
    });

    // The old detail result now arrives late — must not render.
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: oldDetailId,
      phase: "detail",
      analyzedLine: "line one",
      result: { deconstruction: [], context: "stale detail", grammar_rules: [] },
    });

    (container.querySelector("#vidernu-tab-context") as HTMLButtonElement).click();
    const tabPanel = container.querySelector("#vidernu-tabpanel") as HTMLElement;
    expect(tabPanel.textContent).not.toContain("stale detail");

    handle.destroy();
  });

  it("a Stop click sends STOP_ANALYSIS and transitions optimistically — quick intact when stopping detail", () => {
    const handle = mountPanel(shadow, container, () => ({
      present: true,
      text: "hello",
      lang: "ko",
    }));
    markReady(chrome);
    clickAnalyze();
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: lastAnalyzeRequestId("quick"),
      phase: "quick",
      analyzedLine: "hello",
      result: { translation: { literal: "lit", natural: "nat" } },
    });
    (container.querySelector(".vidernu-detail-trigger-btn") as HTMLButtonElement).click();
    const detailId = lastAnalyzeRequestId("detail");

    const stopButton = container.querySelector(".vidernu-stop-btn") as HTMLButtonElement;
    expect(stopButton.hidden).toBe(false);
    stopButton.click();

    expect(chrome.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "STOP_ANALYSIS", requestId: detailId, phase: "detail" }),
    );
    expect(stopButton.hidden).toBe(true);

    // The quick translation is still shown after stopping detail (FR-C4).
    (container.querySelector("#vidernu-tab-translation") as HTMLButtonElement).click();
    const tabPanel = container.querySelector("#vidernu-tabpanel") as HTMLElement;
    expect(tabPanel.textContent).toContain("lit");

    // The detail trigger is offered again (detail back to idle).
    const detailTrigger = container.querySelector(
      ".vidernu-detail-trigger-btn",
    ) as HTMLButtonElement;
    expect(detailTrigger.hidden).toBe(false);

    handle.destroy();
  });

  it("stopping the quick phase resets to a fresh 'ready to analyze' state (FR-C4)", () => {
    const handle = mountPanel(shadow, container, () => ({
      present: true,
      text: "hello",
      lang: "ko",
    }));
    markReady(chrome);
    clickAnalyze();

    const stopButton = container.querySelector(".vidernu-stop-btn") as HTMLButtonElement;
    stopButton.click();

    expect(stopButton.hidden).toBe(true);
    const analyzedLine = container.querySelector(".vidernu-analyzed-line") as HTMLElement;
    expect(analyzedLine.hidden).toBe(true);
    const detailTrigger = container.querySelector(
      ".vidernu-detail-trigger-btn",
    ) as HTMLButtonElement;
    expect(detailTrigger.hidden).toBe(true);

    handle.destroy();
  });

  it("a Retry resends only its phase, leaving the sibling result untouched", () => {
    const handle = mountPanel(shadow, container, () => ({
      present: true,
      text: "hello",
      lang: "ko",
    }));
    markReady(chrome);
    clickAnalyze();
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: lastAnalyzeRequestId("quick"),
      phase: "quick",
      analyzedLine: "hello",
      result: { translation: { literal: "lit", natural: "nat" } },
    });
    (container.querySelector(".vidernu-detail-trigger-btn") as HTMLButtonElement).click();
    chrome.fire({
      type: "ANALYSIS_RESULT",
      requestId: lastAnalyzeRequestId("detail"),
      phase: "detail",
      analyzedLine: "hello",
      result: { error: true, message: "boom" },
    });

    chrome.sendMessage.mockClear();
    (container.querySelector("#vidernu-tab-context") as HTMLButtonElement).click();
    const retryBtn = container.querySelector(
      "#vidernu-tabpanel .vidernu-retry-btn",
    ) as HTMLButtonElement;
    retryBtn.click();

    // Only a new detail request was sent — no quick request re-fired.
    const sentTypes = chrome.sendMessage.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(sentTypes.some((m) => m.type === "ANALYZE_REQUEST" && m.phase === "detail")).toBe(true);
    expect(sentTypes.some((m) => m.type === "ANALYZE_REQUEST" && m.phase === "quick")).toBe(false);

    // The quick translation is still shown, untouched.
    (container.querySelector("#vidernu-tab-translation") as HTMLButtonElement).click();
    const tabPanel = container.querySelector("#vidernu-tabpanel") as HTMLElement;
    expect(tabPanel.textContent).toContain("lit");

    handle.destroy();
  });
});
