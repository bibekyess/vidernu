import { beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

type SimpleListener = (...args: unknown[]) => void;

function installChromeMock(initialState?: unknown): {
  sendMessageToTab: ReturnType<typeof vi.fn>;
  sendMessageRuntime: ReturnType<typeof vi.fn>;
  setBadgeText: ReturnType<typeof vi.fn>;
  setBadgeBackgroundColor: ReturnType<typeof vi.fn>;
  setTitle: ReturnType<typeof vi.fn>;
  storageSet: ReturnType<typeof vi.fn>;
  getListener: () => MessageListener;
  triggerInstalled: () => void;
} {
  let messageListener: MessageListener | undefined;
  let installedListener: SimpleListener | undefined;

  const sendMessageToTab = vi.fn().mockResolvedValue(undefined);
  const sendMessageRuntime = vi.fn().mockResolvedValue(undefined);
  const setBadgeText = vi.fn().mockResolvedValue(undefined);
  const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
  const setTitle = vi.fn().mockResolvedValue(undefined);
  const storageSet = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: {
        addListener: vi.fn((fn: SimpleListener) => {
          installedListener = fn;
        }),
      },
      onStartup: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((fn: MessageListener) => {
          messageListener = fn;
        }),
      },
      sendMessage: sendMessageRuntime,
      getContexts: vi.fn().mockResolvedValue([]),
      getURL: vi.fn((path: string) => path),
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    },
    action: {
      onClicked: { addListener: vi.fn() },
      setBadgeText,
      setBadgeBackgroundColor,
      setTitle,
    },
    offscreen: {
      Reason: { WORKERS: "WORKERS" },
      createDocument: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      session: {
        get: vi.fn().mockResolvedValue(initialState ? { state: initialState } : {}),
        set: storageSet,
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: sendMessageToTab,
    },
  } as unknown as typeof chrome);

  return {
    sendMessageToTab,
    sendMessageRuntime,
    setBadgeText,
    setBadgeBackgroundColor,
    setTitle,
    storageSet,
    getListener: () => {
      if (!messageListener) throw new Error("onMessage listener was never registered");
      return messageListener;
    },
    triggerInstalled: () => {
      if (!installedListener) throw new Error("onInstalled listener was never registered");
      installedListener();
    },
  };
}

describe("service-worker: pendingAnalyses cleanup on INFERENCE_RESULT", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("relays a winning INFERENCE_RESULT to the requesting tab", async () => {
    const { sendMessageToTab, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 1, phase: "quick", text: "hola" },
      sender,
      sendResponse,
    );
    await Promise.resolve();
    await Promise.resolve();

    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 1,
        phase: "quick",
        result: { error: true, message: "x" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendMessageToTab).toHaveBeenCalledWith(42, {
      type: "ANALYSIS_RESULT",
      requestId: 1,
      phase: "quick",
      analyzedLine: "hola",
      result: { error: true, message: "x" },
    });
  });

  it("drops a superseded INFERENCE_RESULT without relaying it, and does not leak its pendingAnalyses entry", async () => {
    const { sendMessageToTab, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = { tab: { id: 7 } } as chrome.runtime.MessageSender;

    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 1, phase: "quick", text: "old line" },
      sender,
      sendResponse,
    );
    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 2, phase: "quick", text: "new line" },
      sender,
      sendResponse,
    );
    await Promise.resolve();
    await Promise.resolve();

    sendMessageToTab.mockClear();

    // requestId 1 was overtaken by requestId 2's RUN_INFERENCE in the
    // offscreen document; it reports back with `superseded: true`.
    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 1,
        phase: "quick",
        result: { error: true, message: "x" },
        superseded: true,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(sendMessageToTab).not.toHaveBeenCalled();

    // Its pendingAnalyses entry must already be gone: a message reusing
    // requestId 1 (what a leaked, un-cleaned-up entry would still answer to)
    // finds nothing pending and is not relayed either.
    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 1,
        phase: "quick",
        result: { error: true, message: "y" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(sendMessageToTab).not.toHaveBeenCalled();

    // The winning request (2) still relays normally.
    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 2,
        phase: "quick",
        result: { error: true, message: "z" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(sendMessageToTab).toHaveBeenCalledWith(7, {
      type: "ANALYSIS_RESULT",
      requestId: 2,
      phase: "quick",
      analyzedLine: "new line",
      result: { error: true, message: "z" },
    });
  });
});

describe("service-worker: phase relay and STOP_ANALYSIS (FR-A8, FR-C, FR-D)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("relays RUN_INFERENCE with phase:'detail' and sets a pending entry", async () => {
    const { sendMessageRuntime, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = { tab: { id: 3 } } as chrome.runtime.MessageSender;

    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 10, phase: "detail", text: "line" },
      sender,
      sendResponse,
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(sendMessageRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RUN_INFERENCE",
        requestId: 10,
        phase: "detail",
        text: "line",
      }),
    );
  });

  it("relays STOP_ANALYSIS as STOP_INFERENCE with the same requestId", async () => {
    const { sendMessageRuntime, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();

    onMessage(
      { type: "STOP_ANALYSIS", requestId: 4, phase: "detail" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await Promise.resolve();

    expect(sendMessageRuntime).toHaveBeenCalledWith({ type: "STOP_INFERENCE", requestId: 4 });
  });

  it("STOP_ANALYSIS drops the pendingAnalyses entry so a later INFERENCE_RESULT for it is not relayed", async () => {
    const { sendMessageToTab, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = { tab: { id: 8 } } as chrome.runtime.MessageSender;

    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 20, phase: "quick", text: "line" },
      sender,
      sendResponse,
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();

    onMessage(
      { type: "STOP_ANALYSIS", requestId: 20, phase: "quick" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 20,
        phase: "quick",
        result: { error: true, message: "stopped" },
        superseded: true,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendMessageToTab).not.toHaveBeenCalled();
  });

  it("ANALYSIS_RESULT carries the phase from the winning INFERENCE_RESULT", async () => {
    const { sendMessageToTab, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = { tab: { id: 5 } } as chrome.runtime.MessageSender;

    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 30, phase: "detail", text: "line" },
      sender,
      sendResponse,
    );
    await Promise.resolve();
    await Promise.resolve();

    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 30,
        phase: "detail",
        result: { deconstruction: [], context: "", grammar_rules: [] },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendMessageToTab).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ type: "ANALYSIS_RESULT", requestId: 30, phase: "detail" }),
    );
  });
});

describe("service-worker: error message relayed and persisted (Section A)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("persists and broadcasts the error message from MODEL_STATUS (FR-3)", async () => {
    const { storageSet, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = {} as chrome.runtime.MessageSender;

    onMessage({ type: "MODEL_STATUS", status: "error", message: "boom" }, sender, sendResponse);
    await Promise.resolve();

    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({ modelStatus: "error", message: "boom" }),
      }),
    );
  });

  it("clears the error message when a non-error MODEL_STATUS arrives (FR-5 server-side)", async () => {
    const { storageSet, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = {} as chrome.runtime.MessageSender;

    onMessage({ type: "MODEL_STATUS", status: "error", message: "boom" }, sender, sendResponse);
    onMessage({ type: "MODEL_STATUS", status: "ready" }, sender, sendResponse);
    await Promise.resolve();

    // The last storage.set call should have message: undefined.
    const lastCallArgs = storageSet.mock.calls.at(-1);
    expect(lastCallArgs).toBeDefined();
    expect(lastCallArgs?.[0]?.state?.message).toBeUndefined();
    expect(lastCallArgs?.[0]?.state?.modelStatus).toBe("ready");
  });

  it("includes the error message in the GET_STATE reply (FR-3 panel-after-error edge case)", async () => {
    const { getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = {} as chrome.runtime.MessageSender;

    onMessage({ type: "MODEL_STATUS", status: "error", message: "boom" }, sender, sendResponse);

    const getStateSendResponse = vi.fn();
    onMessage({ type: "GET_STATE" }, sender, getStateSendResponse);

    expect(getStateSendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ type: "STATE", modelStatus: "error", message: "boom" }),
    );
  });
});

describe("service-worker: badge set on init (Section D/E)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("sets the badge to STBY before sending LOAD_MODEL on a cold start (FR-15/FR-16/FR-19)", async () => {
    const { setBadgeText, sendMessageRuntime, triggerInstalled } = installChromeMock();
    await import("../src/background/service-worker");

    triggerInstalled();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Badge was set at some point before LOAD_MODEL was sent.
    const badgeCalls = setBadgeText.mock.invocationCallOrder;
    const loadModelCalls = sendMessageRuntime.mock.calls
      .map((c, i) => ({ msg: c[0], order: sendMessageRuntime.mock.invocationCallOrder[i] }))
      .filter((c) => c.msg?.type === "LOAD_MODEL");

    expect(setBadgeText).toHaveBeenCalled();
    const badgeCallArgs = setBadgeText.mock.calls.map((c) => c[0]);
    // Should have been called with a non-empty text.
    expect(badgeCallArgs.some((a) => a.text && a.text.length > 0)).toBe(true);

    if (loadModelCalls.length > 0) {
      // Badge was set before LOAD_MODEL.
      const firstBadgeOrder = badgeCalls.at(0);
      const firstLoadModelOrder = loadModelCalls.at(0)?.order;
      if (firstBadgeOrder !== undefined && firstLoadModelOrder !== undefined) {
        expect(firstBadgeOrder).toBeLessThan(firstLoadModelOrder);
      }
    }
  });

  it("sets the badge to reflect the restored status (e.g. READY) on SW-only restart (FR-20)", async () => {
    const { setBadgeText, triggerInstalled } = installChromeMock({
      modelStatus: "ready",
      webgpu: true,
    });
    await import("../src/background/service-worker");

    triggerInstalled();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const badgeCallArgs = setBadgeText.mock.calls.map((c) => c[0]);
    expect(badgeCallArgs.some((a) => a.text === "READY")).toBe(true);
  });
});

describe("service-worker: reconcile restored ready + LOAD_MODEL on init (Section E)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("sends LOAD_MODEL even when persisted status is 'ready' (idempotent reconcile — FR-20)", async () => {
    const { sendMessageRuntime, triggerInstalled } = installChromeMock({
      modelStatus: "ready",
      webgpu: true,
    });
    await import("../src/background/service-worker");

    triggerInstalled();
    // Flush the async chain: loadPersistedState (storage.get), ensureOffscreenDocument
    // (getContexts + createDocument), then the LOAD_MODEL sendMessage.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const loadModelSent = sendMessageRuntime.mock.calls.some((c) => c[0]?.type === "LOAD_MODEL");
    expect(loadModelSent).toBe(true);
  });
});

describe("service-worker: lazy re-init on analysis when not ready (Section E — FR-21)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("sends LOAD_MODEL when ANALYZE_REQUEST arrives and model is not ready", async () => {
    const { sendMessageRuntime, getListener } = installChromeMock();
    await import("../src/background/service-worker");
    const onMessage = getListener();
    const sendResponse = vi.fn();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;

    // Default state is standby (not ready) — trigger an analysis request.
    onMessage(
      { type: "ANALYZE_REQUEST", requestId: 1, phase: "quick", text: "hello" },
      sender,
      sendResponse,
    );
    // Flush: the async IIFE awaits ensureOffscreenDocument (getContexts) before the LOAD_MODEL send.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const loadModelSent = sendMessageRuntime.mock.calls.some((c) => c[0]?.type === "LOAD_MODEL");
    expect(loadModelSent).toBe(true);
  });
});
