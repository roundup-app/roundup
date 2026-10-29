import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";

it.skipIf(!captureDir("U4692"))("u4692_u4692a_rendered_attention_and_discovery", { timeout: 180_000, retry: 0 }, async () => {
  const lane = await openLane(1512, "dark", "builder-4692");
  const failure = "Could not add Workstream: choose another name and try again.";
  const dir = captureDir("U4692")!;
  mkdirSync(dir, { recursive: true });
  try {
    await lane.browser("record", "start", join(dir, "attention.webm"));
    await lane.until("!!window.__fake && !!document.querySelector('.rail-row')");
    await lane.evaluate(`(() => { window.__fake.failNext(-32003, ${JSON.stringify(failure)}); document.querySelector('[aria-label="Add Workstream"]').click(); return true; })()`);
    await lane.until(`document.querySelector('p.ink[role=alert]')?.textContent.includes(${JSON.stringify(failure)})`);
    await lane.capture("U4692", "before");
    for (const [place, selector] of [["rail", ".rail-row"], ["ask", ".ask-input"], ["shelf", ".todo-row-button"], ["terminal", ".pane-screen .xterm-helper-textarea"]]) {
      if (place === "ask") {
        await lane.browser("press", "Meta+/");
        await lane.until("!!document.querySelector('.ask-input')");
      }
      if (place === "shelf") {
        await lane.browser("press", "Meta+k"); await lane.browser("press", "s");
        await lane.until("!!document.querySelector('.shelf')");
        await lane.evaluate(`(() => { document.querySelector('[data-todo-root]')?.click(); document.querySelector('[data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]')?.click(); return true; })()`);
        await lane.until("!!document.querySelector('.todo-row-button')");
      }
      await lane.browser("focus", selector!);
      await lane.browser("press", "Control+Meta+j");
      await lane.until("document.activeElement?.classList.contains('xterm-helper-textarea')");
      expect(await lane.calls("terminal.write")).toEqual([]);
      await lane.capture("U4692", `${place}-jump`);
    }
    await lane.browser("focus", ".rail-row");
    await lane.browser("press", "Shift+?");
    await lane.until("!!document.querySelector('.help')");
    expect(await lane.evaluate("[...document.querySelectorAll('.help .key-chips')].some(chip => chip.textContent === '⌃⌘J')")).toBe(true);
    expect(await lane.evaluate(`document.querySelector('p.ink[role=alert]')?.textContent.includes(${JSON.stringify(failure)})`)).toBe(true);
    await lane.capture("U4692a", "help");
  } finally { try { await lane.browser("record", "stop"); } finally { await lane.close(); } }
});
