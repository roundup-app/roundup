import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

const load = async (seed: string, width: number, scheme: "light" | "dark") => {
  await browser("set", "media", scheme);
  const path = `/harness.html?seed=${seed}`;
  await browser("set", "viewport", String(width), "950");
  await browser("open", url(path));
  await wait(`document.querySelectorAll('.rail-row').length >= 9`);
};

// U4707: hovering the Status Glyph shows the fold chevron, and the hover icons overlay the name's middle, so select by the name's first pixels.
const clickName = async (selector: string) => {
  const point = await read<{x:number;y:number}>(`(() => { const box = document.querySelector('${selector} .name').getBoundingClientRect(); return {x:box.x + 4,y:box.y + box.height / 2}; })()`);
  await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
  await browser("mouse", "down");
  await browser("mouse", "up");
};

const rightClick = async (selector: string) => {
  const point = await read<{x:number;y:number}>(`(() => { const box = document.querySelector('${selector}').getBoundingClientRect(); return {x:box.x + box.width / 2,y:box.y + box.height / 2}; })()`);
  await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
  await browser("mouse", "down", "right");
  await browser("mouse", "up", "right");
};

// Row controls keep Open; former tools retain their native menu paths.
it("u426_menu_actions_run_without_selecting", async () => {
  await load("tree-40", 1280, "light");
  await browser("focus", '.rail-row[data-id="backend"]');
  const selected = await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null");
  await wait(`document.activeElement?.matches('.rail-row[data-id="backend"]')`);
  await browser("press", "Shift+F10");
  await wait("window.__fake.app.menuLabels().includes('Open in editor')");
  await browser("eval", "window.__fake.app.pickMenu('Open in editor')");
  await wait("window.__fake.app.editorOpened.length === 1");
  expect(await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null")).toBe(selected);
  await rightClick('.rail-row[data-id="backend"]');
  await wait("window.__fake.app.menuLabels().includes('Open directory')");
  await browser("eval", "window.__fake.app.pickMenu('Open directory')");
  await wait("window.__fake.app.openedTargets.length === 1");
  expect(await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null")).toBe(selected);
}, 60_000);

it.each(["tree-40", "agents-10", "door-stopped", "conflict"])("u350_rendered_workstream_actions_have_no_clear_%s", async seed => {
  const directory = captureDir("U350");

  const capture = async (step: string) => {
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${step}.png`));
    writeFileSync(join(directory, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`)) + "\n");
  };

  if (directory) {
    mkdirSync(directory, { recursive: true });
    await browser("record", "start", join(directory, `${seed}-intervene.webm`));
  }

  try {
    await browser("set", "media", "dark");
    await browser("set", "viewport", "1512", "950");
    await browser("open", url(`/harness.html?seed=${seed}`));
    await wait(`document.querySelector('.rail-row')`);
    const id = await read<string>(`document.querySelector('.rail-row:has(.rail-chevron)')?.dataset.id ?? document.querySelector('.rail-row').dataset.id`);
    const selector = `.rail-row[data-id="${id}"]`;
    await clickName(selector);
    await wait(`document.querySelector('${selector}').dataset.selected === 'true'`);
    await browser("focus", selector);
    await wait(`document.activeElement.matches('${selector}')`);
    await browser("press", "Shift+F10");
    await wait(`window.__fake.app.shownMenus.length > 0`);
    expect(await read(`window.__fake.app.menuLabels().some(label => /clear/i.test(label))`)).toBe(false);
    await read(`window.__fake.app.closeMenu()`);

    if (seed === "tree-40" || seed === "door-stopped") {
      await rightClick(selector);
      await wait(`window.__fake.app.menuLabels().includes('First prompt…')`);
      await read(`window.__fake.app.pickMenu('First prompt…')`);
      await wait(`document.querySelector('.opening-prompt-dialog')`);
      await capture(`${seed}-opening-prompt`);
      await browser("press", "Escape");
      await wait(`!document.querySelector('.opening-prompt-dialog')`);
    }

    if (seed === "tree-40") {
      await read(`window.__fake.app.openFailure = new Error('Folder unavailable; try again')`);
      await rightClick(selector);
      await read(`window.__fake.app.pickMenu('Open directory')`);
      await wait(`document.body.textContent.includes('Folder unavailable; try again')`);
      await capture("tree-40-failure");
    }

    const agent = await read<string | null>(`document.querySelector('.rail-row:not(:has(.rail-chevron))')?.dataset.id ?? null`);

    if (agent) {
      await browser("click", `.rail-row[data-id="${agent}"] .row-state`);
      await wait(`document.querySelector('.rail-row[data-id="${agent}"]').dataset.selected === 'true'`);
      await wait(`window.__fake.app.calls.some(call => call.method === 'terminal.snapshot')`);
    }

    await capture(`${seed}-terminal`);
    expect(await read(`window.__fake.app.calls.filter(call => call.method === 'workstream.clear')`)).toEqual([]);
  } finally {
    if (directory) await browser("record", "stop");
  }
}, 60_000);
