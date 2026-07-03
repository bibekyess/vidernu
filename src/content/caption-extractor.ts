/**
 * PURE extraction of the single currently-active caption line from YouTube's
 * caption DOM (FR-3.10/3.13). No `chrome.*` references — unit-testable under
 * jsdom against saved DOM fixtures (see test/fixtures/caption-*.html).
 *
 * YouTube's caption markup is private and unstable (accepted risk — see spec
 * Assumptions / NFR "Resilience to YouTube changes"); this module isolates
 * every DOM read so capture failures degrade to `present: false` rather than
 * throwing.
 */

export interface CaptionCapture {
  present: boolean;
  text: string;
  lang?: string;
}

const CAPTION_CONTAINER_SELECTORS = [".ytp-caption-window-container", ".captions-text"];
const LINE_SELECTOR = ".caption-visual-line";
const SEGMENT_SELECTOR = ".ytp-caption-segment";

// Whole-string is nothing but bracket/paren/full-width-bracket sound tags
// (e.g. "[music]", "(applause)", "[music] [applause]") — no analyzable text.
const SOUND_TAG_ONLY_RE = /^(?:[[(【][^\])\]】]*[\])\]】]\s*)+$/u;

function findContainer(root: ParentNode): Element | null {
  for (const selector of CAPTION_CONTAINER_SELECTORS) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function extractSegmentsText(scope: Element): string {
  const segments = Array.from(scope.querySelectorAll(SEGMENT_SELECTOR));
  if (segments.length > 0) {
    return segments
      .map((seg) => (seg.textContent ?? "").trim())
      .filter(Boolean)
      .join(" ");
  }
  return (scope.textContent ?? "").trim();
}

/** Joins every visible line/segment of the active caption window into one string (FR-13). */
function extractLines(container: Element): string[] {
  const lineEls = Array.from(container.querySelectorAll(LINE_SELECTOR));
  if (lineEls.length > 0) {
    return lineEls.map(extractSegmentsText).filter((line) => line.length > 0);
  }
  const whole = extractSegmentsText(container);
  return whole ? [whole] : [];
}

function isSoundTagOnly(text: string): boolean {
  return SOUND_TAG_ONLY_RE.test(text);
}

/** Best-effort active caption-track language, read from the `<track>` element. */
function extractLanguage(root: ParentNode): string | undefined {
  const tracks = Array.from(root.querySelectorAll("track"));
  if (tracks.length === 0) return undefined;
  const active =
    tracks.find((t) => t.getAttribute("data-active") === "true") ??
    tracks.find((t) => t.hasAttribute("default")) ??
    tracks[0];
  return active?.getAttribute("srclang") ?? undefined;
}

/**
 * Extracts the single currently-active caption line from `root` (usually
 * `document`). Never throws: a missing/changed caption container degrades to
 * `{ present: false }` so the caller can surface a "couldn't read the
 * current caption" state instead of hanging (edge case: YouTube DOM change).
 */
export function extractActiveCaption(root: ParentNode): CaptionCapture {
  const lang = extractLanguage(root);
  const container = findContainer(root);
  if (!container) {
    return { present: false, text: "", lang };
  }

  const text = extractLines(container).join(" ").replace(/\s+/g, " ").trim();
  if (!text || isSoundTagOnly(text)) {
    return { present: false, text: "", lang };
  }

  return { present: true, text, lang };
}
