import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractActiveCaption } from "../src/content/caption-extractor";

function loadFixture(name: string): string {
  return readFileSync(join(process.cwd(), "test", "fixtures", name), "utf-8");
}

function withFixture(name: string): Document {
  document.body.innerHTML = loadFixture(name);
  return document;
}

describe("extractActiveCaption", () => {
  it("extracts a single-line caption and its track language", () => {
    const result = extractActiveCaption(withFixture("caption-single.html"));
    expect(result).toEqual({
      present: true,
      text: "안녕하세요, 오늘 날씨가 좋네요.",
      lang: "ko",
    });
  });

  it("joins a multi-line, multi-segment cue into one string (FR-13)", () => {
    const result = extractActiveCaption(withFixture("caption-multiline.html"));
    expect(result.present).toBe(true);
    expect(result.lang).toBe("ja");
    expect(result.text).toBe("今日は いい天気ですね。 散歩に行きましょう。");
  });

  it("treats a sound-effect-tag-only cue as not analyzable", () => {
    const result = extractActiveCaption(withFixture("caption-music-tag.html"));
    expect(result.present).toBe(false);
    expect(result.text).toBe("");
  });

  it("does not throw and reports absent when the caption container is missing", () => {
    const result = extractActiveCaption(withFixture("caption-empty.html"));
    expect(result.present).toBe(false);
    expect(result.text).toBe("");
    expect(result.lang).toBeUndefined();
  });

  it("treats an all-whitespace caption as not analyzable", () => {
    document.body.innerHTML = `
      <div class="ytp-caption-window-container">
        <span class="captions-text">
          <span class="caption-visual-line"><span class="ytp-caption-segment">   </span></span>
        </span>
      </div>`;
    const result = extractActiveCaption(document);
    expect(result.present).toBe(false);
  });

  it("treats a mixed line with a trailing sound tag as analyzable best-effort text", () => {
    document.body.innerHTML = `
      <div class="ytp-caption-window-container">
        <span class="captions-text">
          <span class="caption-visual-line"><span class="ytp-caption-segment">안녕 [music]</span></span>
        </span>
      </div>`;
    const result = extractActiveCaption(document);
    expect(result.present).toBe(true);
    expect(result.text).toBe("안녕 [music]");
  });
});
