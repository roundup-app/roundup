import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U2227 in a real Chromium: the task field's wrapping, growth, cap and outline, read from layout. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U2227 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Read = { pad: number; height: number; line: number; scrollHeight: number; first: number; rowBelow: number; rail: number; width: number; outline: string; border: string; top: number };

/** Page-side: opens the field with `⇧⌘N`, types `text` through the input event, and reads its layout. */
const TYPE = `(text) => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, shiftKey: true, bubbles: true }));
  const field = document.querySelector("textarea[aria-label=Task]");
  field.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  const style = getComputedStyle(field);
  const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "x");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  const line = field.getBoundingClientRect().height - pad;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  const box = field.getBoundingClientRect();
  const row = field.nextElementSibling;
  return {
    height: box.height,
    top: box.top,
    line,
    pad,
    scrollHeight: field.scrollHeight,
    first: field.scrollTop,
    rowBelow: row.getBoundingClientRect().top,
    rail: field.parentElement.getBoundingClientRect().width,
    width: box.width + parseFloat(style.marginLeft),
    outline: style.outlineWidth,
    border: style.borderTopWidth,
  };
}`;

const open = async (scheme: "light" | "dark", text: string): Promise<Read> => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=tree-40", 1280, 800);
  await page.until(`() => document.querySelectorAll(".rail-row").length > 2`);

  return page.call<Read>(TYPE, text);
};

const TASK_200 = "Refactor the session store so every Agent keeps its scroll position across reloads, then add a regression test and update the docs for it. ".repeat(2).slice(0, 200);

run("u2227 the task field in Chromium", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`u2227_the_field_is_a_flat_textarea_with_no_outline_${scheme}`, async () => {
      const read = await open(scheme, "x");

      expect(read.border).toBe("0px");
      expect(read.outline).toBe("0px");
      expect(read.width).toBeCloseTo(read.rail, 0);
    }, 60_000);

    it(`u2227_a_200_character_task_wraps_and_shows_its_first_line_${scheme}`, async () => {
      const read = await open(scheme, TASK_200);

      expect(read.height).toBeGreaterThan(read.line * 1.5);
      expect(read.first).toBe(0);
      expect(Math.ceil(read.height)).toBeGreaterThanOrEqual(Math.min(read.scrollHeight, read.line * 6 + read.pad));
      expect(read.rowBelow).toBeGreaterThanOrEqual(read.top + read.height - 1);
    }, 60_000);

    it(`u2227_a_typed_200_character_task_keeps_its_first_line_in_view_on_reopen_${scheme}`, async () => {
      await page.scheme(scheme);
      await page.load("/harness.html?seed=tree-40", 1280, 800);
      await page.until(`() => document.querySelectorAll(".rail-row").length > 2`);
      await page.press("n", "KeyN", 12);
      await page.until(`() => document.activeElement?.matches("textarea[aria-label=Task]")`);

      for (const char of TASK_200) await page.press(char, char === " " ? "Space" : `Key${char.toUpperCase()}`);
      await page.press("Escape", "Escape");
      await page.press("n", "KeyN", 12);
      await page.until(`() => document.activeElement?.matches("textarea[aria-label=Task]")`);

      const read = await page.call<{ top: number; height: number; scrollHeight: number; value: number }>(
        `() => { const f = document.activeElement; return { top: f.scrollTop, height: f.clientHeight, scrollHeight: f.scrollHeight, value: f.value.length }; }`,
      );

      expect(read.value).toBe(200);
      expect(read.top).toBe(0);
      expect(read.scrollHeight).toBeLessThanOrEqual(read.height);
    }, 60_000);

    it(`u2227_the_field_stops_growing_at_6_lines_${scheme}`, async () => {
      const read = await open(scheme, Array.from({ length: 12 }, (_, at) => `line ${at}`).join("\n"));

      expect(read.height).toBeLessThanOrEqual(read.line * 6 + read.pad);
      expect(read.height).toBeGreaterThanOrEqual(read.line * 6);
      expect(read.scrollHeight).toBeGreaterThan(read.height);
    }, 60_000);
  }
});
