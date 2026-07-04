import { describe, expect, it, vi } from "vitest";

// vi.hoisted runs before any import, so chrome is available when model.ts
// executes its module-level code (env.backends.onnx.wasm.wasmPaths = ...).
vi.hoisted(() => {
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-id/${path}`,
    },
  } as unknown as typeof chrome);
});

// Mock the transformers.js module so model.ts can be imported in jsdom.
// env.backends.onnx.wasm must exist so model.ts can assign wasmPaths into it.
vi.mock("@huggingface/transformers", () => ({
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: {} } },
  },
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

// Verify that model.ts sets wasmPaths to local extension URLs (not CDN) at
// module evaluation time, so ORT never loads its glue script from the network.
// This is the static assertion for the CSP/MV3 fix — the actual runtime load
// (dynamic import of the .mjs inside the extension) requires a real Chrome
// environment and cannot be verified in jsdom.
describe("ORT local wasmPaths setup (CSP fix)", () => {
  // Retrieve the wasmPaths that model.ts assigned at module-evaluation time.
  // env.backends.onnx is typed as Partial<OrtEnv>, making wasm optional; the
  // non-null assertion matches the runtime guarantee (transformers.js always
  // initialises wasm before this module runs).
  async function resolvedWasmPaths() {
    const { env } = await import("@huggingface/transformers");
    return env.backends.onnx.wasm!.wasmPaths as { mjs: string; wasm: string };
  }

  it("sets wasmPaths to chrome-extension:// URLs, not a CDN", async () => {
    // model.ts module-level code assigns wasmPaths; by this point it has run.
    const wasmPaths = await resolvedWasmPaths();
    expect(wasmPaths).toBeDefined();
    expect(wasmPaths.mjs).toMatch(/^chrome-extension:\/\//);
    expect(wasmPaths.wasm).toMatch(/^chrome-extension:\/\//);
    expect(wasmPaths.mjs).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(wasmPaths.wasm).not.toMatch(/cdn\.jsdelivr\.net/);
  });

  it("mjs path ends with the asyncify .mjs filename", async () => {
    const wasmPaths = await resolvedWasmPaths();
    expect(wasmPaths.mjs).toMatch(/ort-wasm-simd-threaded\.asyncify\.mjs$/);
  });

  it("wasm path ends with the asyncify .wasm filename", async () => {
    const wasmPaths = await resolvedWasmPaths();
    expect(wasmPaths.wasm).toMatch(/ort-wasm-simd-threaded\.asyncify\.wasm$/);
  });

  it("mjs and wasm point to the same ort/ directory prefix", async () => {
    const wasmPaths = await resolvedWasmPaths();
    const mjsBase = wasmPaths.mjs.replace(/[^/]+$/, "");
    const wasmBase = wasmPaths.wasm.replace(/[^/]+$/, "");
    expect(mjsBase).toBe(wasmBase);
    expect(mjsBase).toMatch(/\/ort\/$/);
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
