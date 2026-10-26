import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "./laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "u3787a");
  const dir = captureDir("U3787a");

  if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, "drawer-undo.webm")); }
}, 180_000);

afterAll(async () => {
  try { if (lane && captureDir("U3787a")) await lane.browser("record", "stop"); }
  finally { await lane?.close(); }
});

it("u3787a_success_and_partial_failure_offer_only_acknowledged_undo", async () => {
  for (const seed of ["tree-40", "tabs-8", "conflict", "dense-failure"]) {
    await lane.seedTodos(["same", "same", "Long é 🧭 ".repeat(12), "surviving dependent", "fifth"], true, seed === "dense-failure" ? "tree-40" : seed);
    const [id] = await lane.order();
    await lane.browser("focus", `.shelf [data-todo="${id}"] .todo-row-button`);
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.todo-delete')");
    await lane.capture("U3787a", `${seed}-before`);

    if ((seed === "conflict" || seed === "dense-failure")) await lane.evaluate("(() => { window.__fake.failNext(-32003, 'The original Home changed. Restore the Home and retry deletion.'); return true; })()");
    await lane.browser("click", ".todo-delete");

    if ((seed === "conflict" || seed === "dense-failure")) {
      await lane.until("document.body.textContent.includes('The original Home changed')");
      await lane.capture("U3787a", `${seed}-failure`);
    } else {
      await lane.until("[...document.querySelectorAll('button')].some(b => b.textContent === 'Undo')");
      await lane.capture("U3787a", `${seed}-deleted`);
      await lane.evaluate("(() => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').click(); return true; })()");
      await lane.until(`!!document.querySelector('.shelf [data-todo="${id}"]')`);
      expect(await lane.calls("todo.restore")).toHaveLength(1);
      await lane.capture("U3787a", `${seed}-restored`);
    }
  }
}, 180_000);
