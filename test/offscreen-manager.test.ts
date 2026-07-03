import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureOffscreenDocument } from "../src/background/offscreen-manager";

/** Lets pending microtask chains (e.g. `hasOffscreenDocument()`'s awaits) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * Minimal `chrome.runtime`/`chrome.offscreen` stub. `setHasDocument` and
 * `resolvePending` are called directly by tests to drive the scenarios below.
 */
function installChromeMock() {
  let hasDocument = false;
  let createDocumentCalls = 0;
  const pendingResolvers: Array<() => void> = [];

  vi.stubGlobal("chrome", {
    runtime: {
      getContexts: vi.fn(async () => (hasDocument ? [{}] : [])),
      getURL: vi.fn((path: string) => path),
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    },
    offscreen: {
      Reason: { WORKERS: "WORKERS" },
      createDocument: vi.fn(() => {
        createDocumentCalls++;
        return new Promise<void>((resolve) => {
          pendingResolvers.push(() => {
            hasDocument = true;
            resolve();
          });
        });
      }),
    },
  } as unknown as typeof chrome);

  return {
    setHasDocument: (value: boolean) => (hasDocument = value),
    getCreateDocumentCalls: () => createDocumentCalls,
    resolvePending: () => pendingResolvers.splice(0).forEach((resolve) => resolve()),
  };
}

describe("ensureOffscreenDocument", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when a document already exists", async () => {
    const mock = installChromeMock();
    mock.setHasDocument(true);

    await ensureOffscreenDocument();

    expect(mock.getCreateDocumentCalls()).toBe(0);
  });

  it("creates the document exactly once for two near-simultaneous callers", async () => {
    const mock = installChromeMock();

    const first = ensureOffscreenDocument();
    const second = ensureOffscreenDocument();

    // Give both callers' `hasOffscreenDocument()` checks a chance to resolve
    // (each observes "no document yet") before the in-flight `createDocument()`
    // call settles — this is the race the fix guards against.
    await flush();
    expect(mock.getCreateDocumentCalls()).toBe(1);

    mock.resolvePending();
    await Promise.all([first, second]);

    expect(mock.getCreateDocumentCalls()).toBe(1);
  });

  it("allows a later, non-overlapping call to create a fresh document", async () => {
    const mock = installChromeMock();

    const first = ensureOffscreenDocument();
    await flush();
    mock.resolvePending();
    await first;
    expect(mock.getCreateDocumentCalls()).toBe(1);

    // Simulate the offscreen document having since closed.
    mock.setHasDocument(false);
    const second = ensureOffscreenDocument();
    await flush();
    mock.resolvePending();
    await second;

    expect(mock.getCreateDocumentCalls()).toBe(2);
  });
});
