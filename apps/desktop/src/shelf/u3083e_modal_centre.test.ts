import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import type { LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3083e"); }, 180_000);

afterAll(async () => { await lane?.close(); });

/** How far the open modal's centre sits from the window's, in px on each axis. */
const off = (selector: string) => lane.evaluate<number[]>(`(() => {
  const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return [box.left + box.width / 2 - innerWidth / 2, box.top + box.height / 2 - innerHeight / 2];
})()`);

const centred = async (selector: string) => {
  await lane.until(`!!document.querySelector(${JSON.stringify(selector)})`);
  const [x, y] = await off(selector);

  expect(Math.abs(x!)).toBeLessThanOrEqual(1);
  expect(Math.abs(y!)).toBeLessThanOrEqual(1);
};

const reload = async (seed: string) => {
  await lane.browser("eval", "localStorage.clear()").catch(() => undefined);
  await lane.browser("open", (await lane.browser("get", "url")).trim().replace(/seed=[^&]*/, `seed=${seed}`));
  await lane.until("!!window.__fake && document.querySelectorAll('.rail-row').length > 2");
};

/** Types a name, discards it with Escape while storage refuses writes, so the unfinished-work recovery has something to show. */
const strand = async (field: string, name: string) => {
  await lane.evaluate("(() => { Storage.prototype.setItem = () => { throw new Error('disk full'); }; return true; })()");
  await lane.until(`!!document.querySelector(${JSON.stringify(name)})`);
  await lane.evaluate(`(() => { document.querySelector(${JSON.stringify(name)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
  await lane.until(`!!document.querySelector(${JSON.stringify(field)})`);
  await lane.browser("fill", field, "unfinished");
  await lane.browser("press", "Escape");
};

it("u3083e_every_modal_centre_is_the_window_centre", async () => {
  await lane.seedTodos(["first", "second", "third"], false);

  // Bulk delete.
  const [one, two] = await lane.order();

  for (const id of [one, two]) {
    await lane.browser("focus", `.shelf [data-todo="${id}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
  }

  await lane.until("document.querySelector('.shelf-bulk')?.textContent.includes('2 selected')");
  await lane.browser("click", ".shelf-bulk-line button:nth-of-type(1)");
  await centred("[role=alertdialog]");
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('[role=alertdialog]')");

  // The Todo drawer's delete question.
  await lane.browser("click", `.shelf [data-id="${one}"] .todo-row-button`);
  await lane.until("!!document.querySelector('.drawer[data-open=\"true\"]')");
  await lane.until("!!document.querySelector('.todo-delete')");
  await lane.browser("click", ".todo-delete");
  await centred(".todo-delete-confirm");
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('.todo-delete-confirm')");

  // The close dialog.
  await reload("agents-10");
  await lane.evaluate("(() => { document.querySelector('.project-tab[data-selected=true] .tab-close').click(); return true; })()");
  await centred(".close-dialog");

  // The Project tab's recovery.
  await reload("tree-40");
  await strand(".tab-rename", ".tab-name");
  await lane.evaluate("(() => { document.querySelector('[aria-label^=\"Recover unfinished work ·\"]').click(); return true; })()");
  await centred(".header-recovery");

  // A Bubble's recovery.
  await reload("bubbles");
  await lane.browser("click", '[data-id="runner"]');
  await strand(".terminal-tab-editor input", ".terminal-tab-name");
  await lane.evaluate("(() => { document.querySelector('.terminal-recover').click(); return true; })()");
  await centred(".bubble-recovery");
}, 300_000);
