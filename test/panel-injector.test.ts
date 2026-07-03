import { beforeEach, describe, expect, it } from "vitest";

import {
  injectPanel,
  isPanelOpen,
  PANEL_WIDTH_PX,
  removePanel,
  togglePanel,
} from "../src/content/panel-injector";

function setupColumns(): void {
  document.body.innerHTML = `
    <ytd-watch-flexy>
      <div id="page-manager">
        <div id="columns">
          <div id="primary">Video</div>
          <div id="secondary">Related</div>
        </div>
      </div>
    </ytd-watch-flexy>`;
}

describe("panel-injector", () => {
  beforeEach(() => {
    setupColumns();
  });

  it("returns null when #columns cannot be found (YouTube DOM-change edge case)", () => {
    document.body.innerHTML = "<div>no columns here</div>";
    expect(injectPanel(document)).toBeNull();
  });

  it("injects a host as the next sibling of #columns and shrinks it (FR-5.18)", () => {
    const result = injectPanel(document);
    expect(result).not.toBeNull();
    const columns = document.querySelector("#columns") as HTMLElement;
    const host = document.getElementById("vidernu-panel-host");
    expect(host).not.toBeNull();
    expect(host!.previousElementSibling).toBe(columns);
    expect(columns.style.flex).toBe("1 1 auto");
    expect(host!.style.width).toBe(`${PANEL_WIDTH_PX}px`);
  });

  it("attaches an open shadow root with a mount container", () => {
    const result = injectPanel(document)!;
    expect(result.shadow.mode).toBe("open");
    expect(result.container.id).toBe("vidernu-root");
  });

  it("is idempotent: a second injectPanel call reuses the same host", () => {
    const first = injectPanel(document)!;
    const second = injectPanel(document)!;
    expect(second.host).toBe(first.host);
    expect(document.querySelectorAll("#vidernu-panel-host")).toHaveLength(1);
  });

  it("removePanel removes the host and restores #columns' original styles", () => {
    const columns = document.querySelector("#columns") as HTMLElement;
    columns.style.flex = "2 2 auto"; // pre-existing inline style Vidernu must restore
    injectPanel(document);
    removePanel(document);
    expect(document.getElementById("vidernu-panel-host")).toBeNull();
    expect(columns.style.flex).toBe("2 2 auto");
  });

  it("removePanel is a no-op when no panel was ever injected", () => {
    expect(() => removePanel(document)).not.toThrow();
  });

  it("isPanelOpen reflects host presence", () => {
    expect(isPanelOpen(document)).toBe(false);
    injectPanel(document);
    expect(isPanelOpen(document)).toBe(true);
    removePanel(document);
    expect(isPanelOpen(document)).toBe(false);
  });

  it("togglePanel opens then closes", () => {
    expect(togglePanel(document)).not.toBeNull();
    expect(isPanelOpen(document)).toBe(true);
    expect(togglePanel(document)).toBeNull();
    expect(isPanelOpen(document)).toBe(false);
  });
});
