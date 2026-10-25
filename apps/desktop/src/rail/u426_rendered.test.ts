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
  await wait("window.__fake.app.menuLabels().includes('Open folder')");
  await browser("eval", "window.__fake.app.pickMenu('Open folder')");
  await wait("window.__fake.app.openedTargets.length === 1");
  expect(await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null")).toBe(selected);
}, 60_000);

it("u427_the_clear_icon_opens_a_visible_reason_prompt_without_selecting", async () => {
  await load("tree-40", 1512, "dark");
  await browser("click", '.rail-row[data-id="payments"]');
  await wait(`document.querySelector('.rail-row[data-id="payments"]').dataset.selected === 'true'`);
  await read(`window.__fake.app.handlers['workstream.clear'] = () => ({ pending: true })`);
  const before = await read(`window.__fake.app.calls.length`);

  await rightClick('.rail-row[data-id="auth"]');
  await browser("eval", "window.__fake.app.pickMenu('Clear…')");
  await wait(`document.activeElement === document.querySelector('.rail-clear textarea')`);
  expect(await read(`document.querySelector('.rail-row[data-selected="true"]').dataset.id`)).toBe("payments");
  expect(await read(`window.__fake.app.calls.slice(${before}).filter(c => c.method === 'workstream.clear')`)).toEqual([]);
  await browser("find", "role", "button", "click", "--name", "Keep", "--exact");
  await wait(`!document.querySelector('.rail-clear')`);
  await rightClick('.rail-row[data-id="payments"]');
  await browser("eval", "window.__fake.app.pickMenu('Clear…')");
  await wait(`document.activeElement === document.querySelector('.rail-clear textarea')`);
  const reason = "  Keep payments  ";

  await browser("fill", ".rail-clear textarea", reason);
  await wait(`!document.querySelector('.rail-clear button[type=submit]').disabled`);

  const capture = async (step: string) => {
    const directory = captureDir("U427");

    if (!directory) return;

    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${step}.png`));
    writeFileSync(join(directory, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`)) + "\n");
    writeFileSync(join(directory, `${step}-bounds.json`), JSON.stringify(await read(`(() => {
      const bounds = selector => [...document.querySelectorAll(selector)].map(e => ({ text: e instanceof HTMLTextAreaElement ? e.value : e.textContent, bounds: e.getBoundingClientRect().toJSON(), position: getComputedStyle(e).position }));
      return { innerWidth, innerHeight, scrollY, prompt: bounds('.rail-clear'), contents: bounds('.rail-clear textarea, .rail-clear [role=alert], .rail-clear button') };
    })()`)) + "\n");
  };

  await capture("prompt");
  await browser("click", ".rail-clear button[type=submit]");
  await wait(`document.querySelector('.rail-clear textarea').disabled`);
  await capture("pending");
  await read(`window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'workstream.clearFailed', data: { id: 'payments', code: -32008, message: 'Summary timed out.' } })`);
  await wait(`!document.querySelector('.rail-clear textarea').disabled && document.querySelector('.rail-clear [role=alert]')`);
  expect(await read(`document.querySelector('.rail-clear textarea').value`)).toBe(reason);
  await capture("failure");
  await browser("find", "role", "button", "click", "--name", "Clear without a summary", "--exact");
  await wait(`document.querySelector('.rail-clear textarea').disabled`);
  await read(`window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'workstream.clearFailed', data: { id: 'payments', code: -32008, message: 'Summary timed out.' } })`);
  await wait(`!document.querySelector('.rail-clear textarea').disabled`);
  await browser("find", "role", "button", "click", "--name", "Keep", "--exact");
  await wait(`!document.querySelector('.rail-clear')`);
}, 60_000);
