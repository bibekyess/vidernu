/**
 * Regression guard for a class of CSS/JS wiring bug that real-DOM testing
 * caught but jsdom-based DOM assertions cannot: an author rule that sets an
 * unconditional `display` on a class also toggled via the `hidden` attribute
 * beats the user-agent `[hidden] { display: none }` rule in real browsers
 * (author styles outrank user-agent styles at equal specificity), so the
 * element stays visible even while `.hidden` is `true`. jsdom's CSS engine
 * does not model this cascade-origin behavior (verified experimentally:
 * `getComputedStyle` reports `none` in jsdom regardless of the bug), so this
 * test statically inspects the stylesheet source instead of relying on
 * jsdom's computed style.
 *
 * Every class name below is toggled via an element's `.hidden` property
 * somewhere in `render.ts`/`main.ts` (see `PanelElements`). If any of them
 * gains an unconditional `display` declaration in `sidepanel.css` without a
 * `:not([hidden])` (or equivalent `[hidden]`) qualifier, this test fails.
 *
 * Reads the stylesheet straight off disk (not via the app's `?inline`
 * import) because Vitest mocks CSS imports to an empty string by default
 * (`test.css` is not enabled in `vitest.config.ts`) — going through the real
 * import here would make this test vacuously pass regardless of the bug.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const cssText = readFileSync(join(__dirname, "../src/sidepanel/sidepanel.css"), "utf8");

// Classes on elements whose `.hidden` property is toggled at runtime
// (stopButton, detailTrigger, loadError, the three banners, modelState,
// analyzedLine, status — see PanelElements in render.ts).
const HIDEABLE_CLASSES = [
  "vidernu-stop-btn",
  "vidernu-detail-trigger-btn",
  "vidernu-load-error",
  "vidernu-banner",
  "vidernu-model-state",
  "vidernu-analyzed-line",
  "vidernu-status",
];

/** Naive flat-rule tokenizer: good enough for this hand-written, non-nested stylesheet. */
function ruleBlocks(css: string): Array<{ selector: string; body: string }> {
  // Strip comments first — a comment may itself contain literal `{`/`}`
  // (e.g. describing a CSS rule in prose), which would otherwise desync the
  // brace-based tokenizer below.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutComments))) {
    blocks.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
  }
  return blocks;
}

describe("sidepanel.css: hidden-attribute cascade safety", () => {
  const blocks = ruleBlocks(cssText);

  it.each(HIDEABLE_CLASSES)(
    "no rule for .%s sets `display` without a `:not([hidden])` guard",
    (className) => {
      const offending = blocks.filter(
        (b) =>
          b.selector.includes(`.${className}`) &&
          /display\s*:/.test(b.body) &&
          !b.selector.includes(":not([hidden])"),
      );
      expect(offending).toEqual([]);
    },
  );
});
