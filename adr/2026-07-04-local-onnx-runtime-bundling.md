---
title: Bundle ORT runtime locally to satisfy MV3 CSP — no remote scripts
date: 2026-07-04
status: Accepted
supersedes:
superseded-by:
---

# 2026-07-04 — Bundle ORT runtime locally to satisfy MV3 CSP — no remote scripts

## Context

Manifest V3 enforces `script-src 'self'` for extension pages (offscreen documents
included). When the offscreen document initialises the ONNX Runtime Web (ORT) backend
via `@huggingface/transformers`, transformers.js sets `env.backends.onnx.wasm.wasmPaths`
to a `cdn.jsdelivr.net` URL (versioned to the resolved `onnxruntime-web` package) unless
`wasmPaths` is already set. ORT then performs a dynamic `import()` of the `.mjs` glue
script from that CDN URL, which Chrome blocks:

> "Loading the script 'https://cdn.jsdelivr.net/npm/onnxruntime-web@…/dist/
> ort-wasm-simd-threaded.asyncify.mjs' violates the Content Security Policy directive:
> script-src 'self' 'wasm-unsafe-eval' …"

This is the confirmed root cause of the model-load failure on capable hardware. The
asyncify variant (`.mjs` + `.wasm`) is required for the non-Safari WebGPU backend used
by the extension.

## Decision

We will:

1. **Copy the ORT asyncify runtime files** (`ort-wasm-simd-threaded.asyncify.mjs` and
   `ort-wasm-simd-threaded.asyncify.wasm`) from `node_modules/onnxruntime-web/dist/` into
   `dist/ort/` at build time using a minimal Vite plugin (`copyOrtRuntime` in
   `vite.config.ts`). The plugin resolves the package path with `import.meta.resolve()`
   so the version always matches what transformers.js resolved — version drift is
   structurally impossible.

2. **Set `env.backends.onnx.wasm.wasmPaths`** in `src/offscreen/model.ts` at module
   evaluation time, before any `pipeline()` call, pointing to
   `chrome.runtime.getURL("ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}")`. Because
   transformers.js only sets the CDN `wasmPaths` when the property is falsy, this
   pre-assignment permanently blocks the CDN path.

3. **No change to the manifest** (`web_accessible_resources`). The ORT files are loaded
   by the offscreen document, which is an extension page; extension pages can load their
   own resources without `web_accessible_resources` (that entry is only required when
   web-page scripts access extension resources).

The ORT files land at `dist/ort/<name>` with stable, hash-free filenames so
`chrome.runtime.getURL()` can reference them reliably.

## Alternatives considered

- **CDN with a relaxed CSP** (`script-src 'self' https://cdn.jsdelivr.net`) — rejected:
  MV3 extensions cannot declare remote script sources in `content_security_policy`; the
  platform unconditionally enforces `script-src 'self'`.

- **Inline the ORT runtime into the offscreen bundle** — rejected: the ORT WASM glue is
  ~47 kB and the WASM binary is ~23 MB; bundling them as inline Base64/data URIs would
  bloat the bundle unacceptably and break the `wasm-unsafe-eval` instantiation path.

- **vite-plugin-static-copy (or similar)** — rejected: adds a runtime dependency. A
  five-line `generateBundle` hook using Node's built-in `readFileSync` + `emitFile` is
  sufficient and matches the existing devDep style.

- **Serving the ORT files via a separate fetch/proxy** — rejected: unnecessary complexity;
  extension pages can serve files from the extension origin directly.

## Consequences

- Easier: the model-load CSP error is eliminated; ORT loads from `chrome-extension://…`
  which satisfies `script-src 'self'`; version pinning is structurally enforced.
  Running the bundled ORT WASM additionally requires the `'wasm-unsafe-eval'` directive
  in the manifest's `content_security_policy.extension_pages` — MV3's default
  `script-src 'self'` forbids WebAssembly compilation, so this directive is set alongside
  the local-bundling decision to complete the fix.
- Harder / trade-offs: `dist/` grows by ~23 MB (the WASM binary) on top of the existing
  build output. The `.wasm` file was already emitted into `dist/assets/` (hashed) by
  Vite's default asset pipeline; `dist/ort/` is a second copy at a stable path. A future
  clean-up could suppress the hashed copy via Vite asset exclude rules, but the stable
  copy is what matters for correctness and the duplicate is harmless.
- Updating the ORT version requires bumping `onnxruntime-web` in `package.json` (which is
  already a transitive dependency of `@huggingface/transformers`); the build plugin then
  copies the new files automatically.
- End-to-end verification (ORT actually loading the `.mjs` from the extension origin and
  completing model initialisation) requires loading the unpacked extension in Chrome with
  WebGPU; this cannot be asserted in the jsdom/CI harness.
