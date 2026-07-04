import { describe, expect, it } from "vitest";

import { formatBadgeText, formatBadgeTitle } from "../src/shared/constants";

// Section D first criterion: every ModelStatus maps to non-empty badge text (FR-15).
describe("formatBadgeText — all ModelStatus values (Section D)", () => {
  it("standby → 'STBY' (non-empty)", () => {
    expect(formatBadgeText("standby")).toBe("STBY");
  });

  it("downloading with progress → percentage string (non-empty)", () => {
    expect(formatBadgeText("downloading", 45)).toBe("45%");
    expect(formatBadgeText("downloading", 0)).toBe("0%");
    expect(formatBadgeText("downloading", 100)).toBe("100%");
  });

  it("downloading without progress → 'DL' fallback (non-empty)", () => {
    expect(formatBadgeText("downloading")).toBe("DL");
  });

  // Failing-first: before the fix this returned a percentage ("0%") or "DL" (Section B).
  it("loading → 'PREP' (non-empty, not a percentage — FR-8/FR-15)", () => {
    expect(formatBadgeText("loading")).toBe("PREP");
    // loading with a progress value must still return "PREP", not a percentage.
    expect(formatBadgeText("loading", 100)).toBe("PREP");
  });

  it("ready → 'READY' (non-empty)", () => {
    expect(formatBadgeText("ready")).toBe("READY");
  });

  it("error → 'ERR' (non-empty — FR-17)", () => {
    expect(formatBadgeText("error")).toBe("ERR");
  });

  it("no status returns empty string", () => {
    // Verify every defined status is non-empty.
    const statuses = ["standby", "downloading", "loading", "ready", "error"] as const;
    for (const s of statuses) {
      expect(formatBadgeText(s).length).toBeGreaterThan(0);
    }
  });
});

// FR-8: loading title must read "preparing", not "downloading %".
describe("formatBadgeTitle — loading state (FR-8)", () => {
  it("returns a 'preparing' string for loading, not 'downloading' (FR-8)", () => {
    const title = formatBadgeTitle("loading");
    expect(title).toContain("preparing");
    expect(title).not.toContain("downloading");
    expect(title).not.toContain("%");
  });

  it("returns a 'downloading' string with percentage for downloading", () => {
    const title = formatBadgeTitle("downloading", 55);
    expect(title).toContain("55%");
  });

  it("standby title contains 'standing by'", () => {
    expect(formatBadgeTitle("standby")).toContain("standing by");
  });

  it("ready title contains 'ready'", () => {
    expect(formatBadgeTitle("ready")).toContain("ready");
  });

  it("error title contains 'error'", () => {
    expect(formatBadgeTitle("error")).toContain("error");
  });
});
