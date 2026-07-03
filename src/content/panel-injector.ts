/**
 * In-page split-view mechanics for FR-5.18: "a side panel that resizes
 * YouTube's native content wrapper... NOT an overlay". Vidernu injects a
 * flex sibling panel next to YouTube's `#columns` container and shrinks
 * `#columns` to make room, rather than using the native `chrome.sidePanel`
 * browser API (see adr/2026-07-03-inpage-injected-panel-resizes-youtube-columns.md).
 *
 * Pure DOM manipulation — no `chrome.*` references — so the resize/restore
 * logic is unit-testable under jsdom with a synthetic `#columns` fixture.
 */

export const PANEL_HOST_ID = "vidernu-panel-host";
export const PANEL_ROOT_ID = "vidernu-root";
export const PANEL_WIDTH_PX = 380;

// YouTube's watch-page layout wrapper; `ytd-watch-flexy #columns` is a
// defensive fallback in case a bare `#columns` id ever collides elsewhere.
const COLUMNS_SELECTORS = ["ytd-watch-flexy #columns", "#columns"];

interface StyleSnapshot {
  parentDisplay: string;
  columnsFlex: string;
  columnsMinWidth: string;
}

// Keyed by the #columns element so a later removePanel() call (even across a
// re-injection) restores exactly what was there before Vidernu touched it.
const snapshots = new WeakMap<Element, StyleSnapshot>();

export interface InjectedPanel {
  host: HTMLElement;
  shadow: ShadowRoot;
  container: HTMLElement;
}

function findColumns(doc: Document): HTMLElement | null {
  for (const selector of COLUMNS_SELECTORS) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

export function getPanelHost(doc: Document): HTMLElement | null {
  return doc.getElementById(PANEL_HOST_ID);
}

export function isPanelOpen(doc: Document): boolean {
  return getPanelHost(doc) !== null;
}

/**
 * Injects the panel as a flex sibling of `#columns` and shrinks `#columns`
 * to share the row with it. Returns `null` if `#columns` cannot be found
 * (YouTube DOM-change edge case) — the caller degrades to a clear message
 * rather than hanging or silently doing nothing.
 */
export function injectPanel(doc: Document): InjectedPanel | null {
  const existingHost = getPanelHost(doc);
  if (existingHost?.shadowRoot) {
    const container = existingHost.shadowRoot.getElementById(PANEL_ROOT_ID);
    if (container) return { host: existingHost, shadow: existingHost.shadowRoot, container };
  }

  const columns = findColumns(doc);
  if (!columns?.parentElement) return null;
  const parent = columns.parentElement;

  if (!snapshots.has(columns)) {
    snapshots.set(columns, {
      parentDisplay: parent.style.display,
      columnsFlex: columns.style.flex,
      columnsMinWidth: columns.style.minWidth,
    });
  }

  parent.style.display = "flex";
  columns.style.flex = "1 1 auto";
  columns.style.minWidth = "0";

  const host = doc.createElement("div");
  host.id = PANEL_HOST_ID;
  Object.assign(host.style, {
    flex: `0 0 ${PANEL_WIDTH_PX}px`,
    width: `${PANEL_WIDTH_PX}px`,
    minWidth: `${PANEL_WIDTH_PX}px`,
    maxWidth: `${PANEL_WIDTH_PX}px`,
    height: "100%",
    overflow: "auto",
  });
  parent.insertBefore(host, columns.nextSibling);

  const shadow = host.attachShadow({ mode: "open" });
  const container = doc.createElement("div");
  container.id = PANEL_ROOT_ID;
  shadow.appendChild(container);

  return { host, shadow, container };
}

/** Removes the injected panel and restores `#columns` to its prior layout. */
export function removePanel(doc: Document): void {
  getPanelHost(doc)?.remove();

  const columns = findColumns(doc);
  if (!columns) return;
  const snapshot = snapshots.get(columns);
  if (!snapshot) return;

  if (columns.parentElement) columns.parentElement.style.display = snapshot.parentDisplay;
  columns.style.flex = snapshot.columnsFlex;
  columns.style.minWidth = snapshot.columnsMinWidth;
  snapshots.delete(columns);
}

export function togglePanel(doc: Document): InjectedPanel | null {
  if (isPanelOpen(doc)) {
    removePanel(doc);
    return null;
  }
  return injectPanel(doc);
}
