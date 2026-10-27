import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3787c-rail"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it.each(["tree-40", "tabs-8", "conflict"])("u3787c_rail_dense_selection_and_recoverable_rename %s", async seed => {
  const dir = captureDir("U3787c");

  if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, `rail-${seed}.webm`)); }

  try {
    await lane.seedTodos(["one", "two", "three", "four", "five"], true, seed);
    await lane.evaluate(`(async () => {
      for (const name of ['same', 'same', '長い名前 é 🧭 '.repeat(10), 'fourth', 'fifth']) await window.__fake.app.rpc('rail.createWorkstream', { name, parent: null });
      return true;
    })()`);
    await lane.browser("set", "media", "dark");
    await lane.until("document.querySelectorAll('.rail-row').length >= 5");
    await lane.resetCalls();
    await lane.browser("focus", ".rail-row");
    await lane.capture("U3787c", `rail-${seed}-before`);
    await lane.browser("press", "Meta+a");
    await lane.until("document.querySelectorAll('.rail-row[data-selected=true]').length === document.querySelectorAll('.rail-row').length");
    expect(await lane.calls()).toEqual([]);
    await lane.capture("U3787c", `rail-${seed}-selected`);
    await lane.browser("press", "F2");
    await lane.until("document.activeElement?.matches('.rail-row input')");
    await lane.browser("fill", ".rail-row input", "  é 🧭 終  ");
    await lane.browser("press", "Escape");
    await lane.until("document.activeElement?.matches('.rail-row') && !document.querySelector('.rail-row input')");
    expect(await lane.calls("rail.rename")).toEqual([]);
    await lane.capture("U3787c", `rail-${seed}-cancelled`);
    await lane.browser("press", "F2");
    await lane.until("document.activeElement?.matches('.rail-row input')");
    expect(await lane.evaluate<string>("document.activeElement.value")).toBe("  é 🧭 終  ");
    await lane.browser("press", "Escape");
    await lane.until("document.activeElement?.matches('.rail-row') && !document.querySelector('.rail-row input')");

    if (seed === "tree-40") {
      await lane.browser("press", "F2");
      await lane.until("document.activeElement?.matches('.rail-row input')");
      await lane.evaluate("(() => { window.__fake.failNext(-32003, 'Name unavailable. Choose another name.'); return true; })()");
      await lane.browser("press", "Enter");
      await lane.until("document.querySelector('[role=alert]')?.textContent.includes('Name unavailable. Choose another name.')");
      await lane.capture("U3787c", "rail-tree-40-failed-rename");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.rail-row input')");
    }
  } finally { if (dir) await lane.browser("record", "stop"); }
}, 180_000);
