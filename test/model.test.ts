import { describe, expect, it, vi } from "vitest";

// Mock the transformers.js module so model.ts can be imported in jsdom.
vi.mock("@huggingface/transformers", () => ({
  env: { allowLocalModels: false, useBrowserCache: true },
  pipeline: vi.fn(),
}));

// Import the pure helpers after the mock is installed.
// `toLoadProgress` is private so we test it indirectly via `loadModel`'s
// progress callback — but `deriveErrorMessage` and `resetPipeline` are public exports.
import { deriveErrorMessage } from "../src/offscreen/model";
import { MODEL_LOAD_FALLBACK_MESSAGE } from "../src/shared/constants";

describe("deriveErrorMessage", () => {
  it("returns the Error.message for a plain Error (Section A)", () => {
    expect(deriveErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("collapses multi-line Error.message to a single line", () => {
    expect(deriveErrorMessage(new Error("line one\nline two\n  indented"))).toBe(
      "line one line two indented",
    );
  });

  it("returns the fallback for a string throw (Section A non-Error edge case)", () => {
    expect(deriveErrorMessage("weird")).toBe(MODEL_LOAD_FALLBACK_MESSAGE);
  });

  it("returns the fallback for an object throw", () => {
    expect(deriveErrorMessage({ code: 42 })).toBe(MODEL_LOAD_FALLBACK_MESSAGE);
  });

  it("returns the fallback for an Error with an empty message (Section A empty-message edge case)", () => {
    expect(deriveErrorMessage(new Error(""))).toBe(MODEL_LOAD_FALLBACK_MESSAGE);
  });

  it("returns the fallback for an Error with a whitespace-only message", () => {
    expect(deriveErrorMessage(new Error("   "))).toBe(MODEL_LOAD_FALLBACK_MESSAGE);
  });

  it("returns the fallback for null/undefined throws", () => {
    expect(deriveErrorMessage(null)).toBe(MODEL_LOAD_FALLBACK_MESSAGE);
    expect(deriveErrorMessage(undefined)).toBe(MODEL_LOAD_FALLBACK_MESSAGE);
  });
});

// toLoadProgress is not exported, so we drive it through loadModel's progress_callback.
// We import the pipeline mock to capture the callback and invoke it with ProgressInfo fixtures.
describe("toLoadProgress (via loadModel progress_callback) — Section B", () => {
  it("maps the 'done' event to { status: 'loading' } (not downloading 100%)", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipelineMock = vi.mocked(pipeline);

    let capturedCallback: ((info: unknown) => void) | undefined;
    // Cast to `any` to avoid fighting the heavily-overloaded `pipeline` signature in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipelineMock as any).mockImplementationOnce(
      (
        _task: unknown,
        _model: unknown,
        opts: { progress_callback?: (info: unknown) => void } | undefined,
      ) => {
        capturedCallback = opts?.progress_callback;
        return new Promise(() => {}); // never resolves — we only care about the callback
      },
    );

    const { loadModel, resetPipeline } = await import("../src/offscreen/model");
    const progresses: Array<{ status: string; progress?: number }> = [];

    void loadModel((p) => progresses.push(p));
    await Promise.resolve(); // let the pipeline mock start

    // Emit a "done" event — should surface as loading, not downloading.
    capturedCallback?.({ status: "done" });
    expect(progresses).toHaveLength(1);
    expect(progresses.at(0)?.status).toBe("loading");
    expect(progresses.at(0)?.progress).toBeUndefined();

    // Clean up so other tests start fresh.
    resetPipeline();
  });

  it("maps 'progress' events to downloading with an advancing percentage", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipelineMock = vi.mocked(pipeline);

    let capturedCallback: ((info: unknown) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipelineMock as any).mockImplementationOnce(
      (
        _task: unknown,
        _model: unknown,
        opts: { progress_callback?: (info: unknown) => void } | undefined,
      ) => {
        capturedCallback = opts?.progress_callback;
        return new Promise(() => {});
      },
    );

    const { loadModel, resetPipeline } = await import("../src/offscreen/model");
    const progresses: Array<{ status: string; progress?: number }> = [];

    void loadModel((p) => progresses.push(p));
    await Promise.resolve();

    capturedCallback?.({ status: "progress", file: "model.bin", loaded: 50, total: 100 });
    expect(progresses.at(0)?.status).toBe("downloading");
    expect(progresses.at(0)?.progress).toBe(50);

    resetPipeline();
  });
});
