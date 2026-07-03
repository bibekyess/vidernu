import { beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

function installChromeMock(): {
  sendMessageToTab: ReturnType<typeof vi.fn>;
  getListener: () => MessageListener;
} {
  let listener: MessageListener | undefined;
  const sendMessageToTab = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((fn: MessageListener) => {
          listener = fn;
        }),
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getContexts: vi.fn().mockResolvedValue([]),
      getURL: vi.fn((path: string) => path),
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    },
    action: { onClicked: { addListener: vi.fn() } },
    offscreen: {
      Reason: { WORKERS: "WORKERS" },
      createDocument: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: sendMessageToTab,
    },
  } as unknown as typeof chrome);

  return {
    sendMessageToTab,
    getListener: () => {
      if (!listener) throw new Error("onMessage listener was never registered");
      return listener;
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

    onMessage({ type: "ANALYZE_REQUEST", requestId: 1, text: "hola" }, sender, sendResponse);
    await Promise.resolve();
    await Promise.resolve();

    onMessage(
      { type: "INFERENCE_RESULT", requestId: 1, result: { error: true, message: "x" } },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendMessageToTab).toHaveBeenCalledWith(42, {
      type: "ANALYSIS_RESULT",
      requestId: 1,
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

    onMessage({ type: "ANALYZE_REQUEST", requestId: 1, text: "old line" }, sender, sendResponse);
    onMessage({ type: "ANALYZE_REQUEST", requestId: 2, text: "new line" }, sender, sendResponse);
    await Promise.resolve();
    await Promise.resolve();

    sendMessageToTab.mockClear();

    // requestId 1 was overtaken by requestId 2's RUN_INFERENCE in the
    // offscreen document; it reports back with `superseded: true`.
    onMessage(
      {
        type: "INFERENCE_RESULT",
        requestId: 1,
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
      { type: "INFERENCE_RESULT", requestId: 1, result: { error: true, message: "y" } },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(sendMessageToTab).not.toHaveBeenCalled();

    // The winning request (2) still relays normally.
    onMessage(
      { type: "INFERENCE_RESULT", requestId: 2, result: { error: true, message: "z" } },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(sendMessageToTab).toHaveBeenCalledWith(7, {
      type: "ANALYSIS_RESULT",
      requestId: 2,
      analyzedLine: "new line",
      result: { error: true, message: "z" },
    });
  });
});
