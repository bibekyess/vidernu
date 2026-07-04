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
    /** Fire an incoming extension message at the panel's listener. */
    fire(msg: unknown): void {
      onMessageListener?.(msg);
    },
  };
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
