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

    onMessage({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "first line" });
    await Promise.resolve();

    onMessage({ type: "RUN_INFERENCE", requestId: 2, phase: "quick", text: "second line" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The newer request (2) wins immediately and posts without a superseded flag.
    expect(sendMessage).toHaveBeenCalledWith({
      type: "INFERENCE_RESULT",
      requestId: 2,
      phase: "quick",
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
      phase: "quick",
      result: { error: true, message: "first" },
      superseded: true,
    });
  });
});

describe("offscreen: phase routing (FR-B1)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    runInferenceMock.mockReset();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
  });

  it("passes phase through to runInference for quick and detail requests", async () => {
    const { getListener } = installChromeMock();
    runInferenceMock.mockResolvedValue({ translation: { literal: "l", natural: "n" } });

    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "line", lang: "ko" });
    await Promise.resolve();
    await Promise.resolve();

    expect(runInferenceMock).toHaveBeenCalledWith("line", "ko", "quick", expect.any(Function));

    onMessage({ type: "RUN_INFERENCE", requestId: 2, phase: "detail", text: "line2", lang: "ko" });
    await Promise.resolve();
    await Promise.resolve();

    expect(runInferenceMock).toHaveBeenCalledWith("line2", "ko", "detail", expect.any(Function));
  });

  it("posts the result with the same phase it was requested with", async () => {
    const { sendMessage, getListener } = installChromeMock();
    runInferenceMock.mockResolvedValue({ deconstruction: [], context: "", grammar_rules: [] });

    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "RUN_INFERENCE", requestId: 5, phase: "detail", text: "line" });
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "INFERENCE_RESULT", requestId: 5, phase: "detail" }),
    );
  });
});

describe("offscreen: STOP_INFERENCE cancel marker (FR-C)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    runInferenceMock.mockReset();
    detectWebGPUMock.mockReset();
    loadModelMock.mockReset();
    resetPipelineMock.mockReset();
  });

  it("STOP_INFERENCE for the in-flight id flips isSuperseded so the result posts with superseded:true", async () => {
    const { sendMessage, getListener } = installChromeMock();

    let capturedIsSuperseded: (() => boolean) | undefined;
    const pending = deferred<{ error: true; message: string }>();
    runInferenceMock.mockImplementationOnce((...args: unknown[]) => {
      capturedIsSuperseded = args[3] as () => boolean;
      return pending.promise;
    });

    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "line" });
    await Promise.resolve();

    expect(capturedIsSuperseded?.()).toBe(false);

    onMessage({ type: "STOP_INFERENCE", requestId: 1 });

    expect(capturedIsSuperseded?.()).toBe(true);

    pending.resolve({ error: true, message: "stopped" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "INFERENCE_RESULT",
      requestId: 1,
      phase: "quick",
      result: { error: true, message: "stopped" },
      superseded: true,
    });
  });

  it("STOP_INFERENCE for a non-current id is a no-op", async () => {
    const { sendMessage, getListener } = installChromeMock();

    let capturedIsSuperseded: (() => boolean) | undefined;
    const pending = deferred<{ error: true; message: string }>();
    runInferenceMock.mockImplementationOnce((...args: unknown[]) => {
      capturedIsSuperseded = args[3] as () => boolean;
      return pending.promise;
    });

    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "line" });
    await Promise.resolve();

    // Stop a stale id that is not the in-flight one.
    onMessage({ type: "STOP_INFERENCE", requestId: 999 });
    expect(capturedIsSuperseded?.()).toBe(false);

    pending.resolve({ error: true, message: "ok" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "INFERENCE_RESULT",
      requestId: 1,
      phase: "quick",
      result: { error: true, message: "ok" },
    });
  });

  it("resets a stale cancelledRequestId so it never suppresses a later request reusing the same id", async () => {
    // Defensive coverage for the reset in handleRunInference: even if a
    // requestId were ever reused (the real counter is monotonic, but the
    // module must not silently rely on that for correctness), a cancel
    // stamped on a since-completed request must not leak into a brand-new
    // request that happens to reuse the same id.
    const { sendMessage, getListener } = installChromeMock();

    let firstIsSuperseded: (() => boolean) | undefined;
    const firstPending = deferred<{ error: true; message: string }>();
    runInferenceMock.mockImplementationOnce((...args: unknown[]) => {
      firstIsSuperseded = args[3] as () => boolean;
      return firstPending.promise;
    });
    let secondIsSuperseded: (() => boolean) | undefined;
    const secondPending = deferred<{ error: true; message: string }>();
    runInferenceMock.mockImplementationOnce((...args: unknown[]) => {
      secondIsSuperseded = args[3] as () => boolean;
      return secondPending.promise;
    });

    await import("../src/offscreen/offscreen");
    const onMessage = getListener();

    onMessage({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "line" });
    await Promise.resolve();

    onMessage({ type: "STOP_INFERENCE", requestId: 1 });
    expect(firstIsSuperseded?.()).toBe(true);

    firstPending.resolve({ error: true, message: "stopped" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // A new request reuses id 1. The reset at the top of handleRunInference
    // must clear the stale cancel so this legitimate request is not
    // immediately treated as cancelled.
    onMessage({ type: "RUN_INFERENCE", requestId: 1, phase: "quick", text: "line2" });
    await Promise.resolve();

    expect(secondIsSuperseded?.()).toBe(false);

    secondPending.resolve({ error: true, message: "second" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "INFERENCE_RESULT",
      requestId: 1,
      phase: "quick",
      result: { error: true, message: "second" },
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
