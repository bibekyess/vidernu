import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the mock factories below can reference them before `vi.mock` is
// hoisted above the imports.
const { runInferenceMock, detectWebGPUMock, loadModelMock } = vi.hoisted(() => ({
  runInferenceMock: vi.fn(),
  detectWebGPUMock: vi.fn(),
  loadModelMock: vi.fn(),
}));

vi.mock("../src/offscreen/inference", () => ({ runInference: runInferenceMock }));
vi.mock("../src/offscreen/capability", () => ({ detectWebGPU: detectWebGPUMock }));
vi.mock("../src/offscreen/model", () => ({ loadModel: loadModelMock }));

type MessageListener = (message: unknown) => void;

function installChromeMock(): {
  sendMessage: ReturnType<typeof vi.fn>;
  getListener: () => MessageListener;
} {
  let listener: MessageListener | undefined;
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((fn: MessageListener) => {
          listener = fn;
        }),
      },
    },
  } as unknown as typeof chrome);

  return {
    sendMessage,
    getListener: () => {
      if (!listener) throw new Error("onMessage listener was never registered");
      return listener;
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("offscreen: superseded RUN_INFERENCE requests (FR-17 latest-wins)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    runInferenceMock.mockReset();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
  });

  it("still posts INFERENCE_RESULT with superseded:true for the request a newer one overtook", async () => {
    const { sendMessage, getListener } = installChromeMock();

    const first = deferred<{ error: true; message: string }>();
    runInferenceMock.mockImplementationOnce(() => first.promise);
    runInferenceMock.mockImplementationOnce(async () => ({ error: true, message: "second" }));

    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "RUN_INFERENCE", requestId: 1, text: "first line" });
    await Promise.resolve();

    onMessage({ type: "RUN_INFERENCE", requestId: 2, text: "second line" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The newer request (2) wins immediately and posts without a superseded flag.
    expect(sendMessage).toHaveBeenCalledWith({
      type: "INFERENCE_RESULT",
      requestId: 2,
      result: { error: true, message: "second" },
    });

    sendMessage.mockClear();
    first.resolve({ error: true, message: "first" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The overtaken request (1) still posts — with superseded:true — instead
    // of silently dropping the result and leaking its pendingAnalyses entry
    // on the service-worker side.
    expect(sendMessage).toHaveBeenCalledWith({
      type: "INFERENCE_RESULT",
      requestId: 1,
      result: { error: true, message: "first" },
      superseded: true,
    });
  });
});
