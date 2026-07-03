/**
 * Device / WebGPU capability detection (FR-2). Best-effort only — there is
 * no reliable JS API for exact VRAM, so `lowPowerHint` is a heuristic
 * advisory, never a hard gate (FR-9.33).
 */

export interface Capability {
  webgpu: boolean;
  lowPowerHint?: boolean;
  adapterInfo?: string;
}

const SOFTWARE_ADAPTER_RE = /swiftshader|software|llvmpipe|basic render/i;

export async function detectWebGPU(): Promise<Capability> {
  if (!("gpu" in navigator) || !navigator.gpu) {
    return { webgpu: false };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { webgpu: false };

    const info = adapter.info;
    const description = info?.description || info?.vendor || info?.architecture || undefined;
    const lowPowerHint =
      info?.isFallbackAdapter === true || SOFTWARE_ADAPTER_RE.test(description ?? "");

    return { webgpu: true, lowPowerHint, adapterInfo: description };
  } catch {
    return { webgpu: false };
  }
}
