import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the mock factories below can reference them before `vi.mock` is
// hoisted above the imports.
const { runInferenceMock, detectWebGPUMock, loadModelMock, resetPipelineMock } = vi.hoisted(() => ({
  runInferenceMock: vi.fn(),
  detectWebGPUMock: vi.fn(),
  loadModelMock: vi.fn(),
  resetPipelineMock: vi.fn(),
}));

vi.mock("../src/offscreen/inference", () => ({ runInference: runInferenceMock }));
vi.mock("../src/offscreen/capability", () => ({ detectWebGPU: detectWebGPUMock }));
vi.mock("../src/offscreen/model", () => ({
  loadModel: loadModelMock,
  resetPipeline: resetPipelineMock,
  deriveErrorMessage: (err: unknown) => {
    // Mirror the real implementation so offscreen tests don't need the full module.
    if (err instanceof Error && err.message.trim() !== "") {
      return err.message.replace(/\s+/g, " ").trim();
    }
    return "The model failed to load.";
  },
}));

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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("offscreen: superseded RUN_INFERENCE requests (FR-17 latest-wins)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    runInferenceMock.mockReset();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
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

describe("offscreen: real error surfaced (Section A)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    runInferenceMock.mockReset();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("console.errors the thrown Error and posts MODEL_STATUS error with its message", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });
    loadModelMock.mockRejectedValue(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Full Error logged to offscreen console (FR-1).
    expect(consoleSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));

    // Single-line message propagated in MODEL_STATUS (FR-2).
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "MODEL_STATUS", status: "error", message: "boom" }),
    );

    consoleSpy.mockRestore();
  });

  it("posts the generic fallback message for a non-Error throw (Section A edge case)", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });
    loadModelMock.mockRejectedValue("weird");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Raw value still logged (FR-1).
    expect(consoleSpy).toHaveBeenCalledWith("weird");

    // Generic fallback in the payload (FR-2).
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MODEL_STATUS",
        status: "error",
        message: "The model failed to load.",
      }),
    );

    consoleSpy.mockRestore();
  });
});

describe("offscreen: loading state posted in a normal load (Section B)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a 'loading' status between the last 'downloading' and 'ready'", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });

    // Simulate loadModel invoking the callback with a "loading" progress then resolving.
    loadModelMock.mockImplementation(
      async (onProgress: (p: { status: string; progress?: number }) => void) => {
        onProgress({ status: "downloading", progress: 50 });
        onProgress({ status: "loading" }); // "done" event maps here (FR-7)
      },
    );

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const calls = sendMessage.mock.calls.map((c) => c[0]);
    const statusMessages = calls.filter((m) => m.type === "MODEL_STATUS");
    const statuses = statusMessages.map((m) => m.status);

    expect(statuses).toContain("loading");
    expect(statuses).toContain("ready");

    // "loading" must appear strictly before "ready".
    const loadingIdx = statuses.indexOf("loading");
    const readyIdx = statuses.indexOf("ready");
    expect(loadingIdx).toBeLessThan(readyIdx);
  });
});

describe("offscreen: stall timeout (Section C)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions to error with the timeout message when no progress for 120s", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // A load that never resolves and emits no progress.
    loadModelMock.mockReturnValue(new Promise(() => {}));

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();

    // Advance exactly 120s.
    vi.advanceTimersByTime(120_000);
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("stalled"));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MODEL_STATUS",
        status: "error",
        message: expect.stringContaining("stalled"),
      }),
    );

    // Pipeline cleared so retry starts fresh (FR-13).
    expect(resetPipelineMock).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("does NOT fire a timeout error when progress resets the timer before 120s elapses", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });

    let capturedProgress: ((p: { status: string; progress?: number }) => void) | undefined;
    const { promise: loadPromise } = deferred();
    loadModelMock.mockImplementation(
      async (onProgress: (p: { status: string; progress?: number }) => void) => {
        capturedProgress = onProgress;
        return loadPromise;
      },
    );

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();

    // Advance 100s — no timeout yet.
    vi.advanceTimersByTime(100_000);
    // Emit a progress update at t=100s — resets the stall timer.
    capturedProgress?.({ status: "downloading", progress: 80 });

    // Advance another 50s (total 150s, but only 50s since last progress).
    vi.advanceTimersByTime(50_000);
    await Promise.resolve();

    const errorCalls = sendMessage.mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === "MODEL_STATUS" && m.status === "error");

    expect(errorCalls).toHaveLength(0);
  });

  it("cancels the timer when the model reaches ready — no error emitted afterward", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });

    const { promise: loadPromise, resolve: resolveLoad } = deferred<void>();
    loadModelMock.mockImplementation(async () => {
      return loadPromise;
    });

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();

    // Resolve the load before the timeout.
    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Advance past the timeout duration — should NOT trigger an error.
    vi.advanceTimersByTime(200_000);
    await Promise.resolve();

    const modelStatusCalls = sendMessage.mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === "MODEL_STATUS");

    const terminal = modelStatusCalls.filter((m) => m.status === "ready" || m.status === "error");
    // Exactly one terminal status — "ready" — no dangling error after (FR-11).
    expect(terminal).toHaveLength(1);
    expect(terminal[0].status).toBe("ready");
  });

  it("handles the timeout-vs-ready race: exactly one terminal MODEL_STATUS", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });

    const { promise: loadPromise, resolve: resolveLoad } = deferred<void>();
    loadModelMock.mockImplementation(async () => loadPromise);

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    await Promise.resolve();

    // Fire the timeout and resolve the load "simultaneously".
    vi.advanceTimersByTime(120_000);
    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const terminal = sendMessage.mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === "MODEL_STATUS" && (m.status === "ready" || m.status === "error"));

    // Must be exactly one terminal, not two.
    expect(terminal).toHaveLength(1);
  });
});

describe("offscreen: double LOAD_MODEL in-flight guard (edge case)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses the in-flight load — 'downloading 0' is posted exactly once", async () => {
    detectWebGPUMock.mockResolvedValue({ webgpu: true });
    loadModelMock.mockReturnValue(new Promise(() => {})); // never resolves

    const { sendMessage, getListener } = installChromeMock();
    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "LOAD_MODEL" });
    await Promise.resolve();
    onMessage({ type: "LOAD_MODEL" }); // second while first is in flight
    await Promise.resolve();

    const downloadingZero = sendMessage.mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === "MODEL_STATUS" && m.status === "downloading" && m.progress === 0);

    expect(downloadingZero).toHaveLength(1);
  });
});
