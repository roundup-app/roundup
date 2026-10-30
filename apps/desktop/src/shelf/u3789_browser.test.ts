import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";

const shot = async (id: string, stage: string, step: string) => {
  const checks = await read<Checks>("window.__checks()");
  const directory = captureDir(id);

  if (directory) {
    const folder = join(directory, stage);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${step}.checks.json`), JSON.stringify(checks) + "\n");
    await browser("screenshot", join(folder, `${step}.png`));

    const boxes = await read(`Array.from(document.querySelectorAll('.rail-row, .shelf-row')).map(row => ({id:row.dataset.id ?? row.dataset.todo ?? row.dataset.incarnation, box:row.getBoundingClientRect().toJSON(), state:row.querySelector('.row-state .glyph, .shelf-glyph .glyph')?.getBoundingClientRect().toJSON(), name:row.querySelector('.name, .shelf-title, .pad-name')?.getBoundingClientRect().toJSON(), controls:Array.from(row.querySelectorAll('button,input[type=checkbox]')).filter(control => getComputedStyle(control).opacity !== '0' && control.checkVisibility({opacityProperty:true})).map(control => control.getAttribute('aria-label'))}))`);
    writeFileSync(join(folder, `${step}.rows.json`), JSON.stringify(boxes) + "\n");
  }

  return checks;
};

const load = async (seed: string, base = false) => {
  await browser("open", url(`/harness.html?seed=${seed}`, base));
  await wait("window.__fake && document.querySelector('.rail-tree')");
  await browser("eval", "localStorage.clear()");
  await browser("open", url(`/harness.html?seed=${seed}`, base));
  await wait("window.__fake && document.querySelector('.rail-tree')");
};

it("u3800a_owned_todo_grip_reorders_once", async () => {
  await load("tree-40");
  await browser("eval", `document.querySelector('.rail-row[data-id="tokens"] [data-pads-control]').click()`);
  await wait('document.querySelectorAll(".todos-tab .sortable-handle").length > 1');
  const grip = '.todos-tab [data-todo="1"] .sortable-handle';
  await browser("eval", "window.__fake.app.calls.length = 0");
  await browser("focus", grip);
  await browser("press", "Space");
  await wait('document.querySelector("[data-dnd-placeholder]")');
  await shot("U3800a", "head", "owned-todo-slot");
  await browser("press", "ArrowDown");
  await wait(`document.querySelector('.todos-tab [data-todo="1"]').closest(".todo-list").dataset.sortableIndex === "1"`);
  await browser("press", "Space");
  await wait('!document.querySelector("[data-dnd-placeholder]")');
  expect(await read("window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params)")).toEqual([{id:1,before:3}]);
  expect(await read("window.__fake.app.calls.filter(c => ['todo.getHistory','todo.complete','todo.update','pad.write'].includes(c.method))")).toEqual([]);
  await wait(`document.activeElement === document.querySelector('${grip}')`);
}, 60_000);

