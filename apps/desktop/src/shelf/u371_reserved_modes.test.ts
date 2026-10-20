import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { browser, evaluate, settle, openShelf, toggle } = shelfBrowser();

it("u369_closed_shelf_releases_its_width", async () => {
  await openShelf();
  await toggle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
}, 90_000);

for (const available of [387, 388]) it(`u371_minimum_pane_width_selects_the_mode_${available}`, async () => {
  await openShelf("tree-40", 480, 800 - available);
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe(available === 387 ? "overlay" : "reserved");
  expect(await evaluate("Boolean(document.querySelector('.shelf-scrim'))")).toBe(available === 387);
}, 90_000);

const capture = async (name: string) => {
  const root = captureDir("U2892");

  if (!root) return;
  const dir = join(root, "head");

  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${name}.png`));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
};

const captureViewport = async () => {
  if (!captureDir("U2892")) return;
  // Expose the overlay at the acceptance viewport despite the normal wide-window reserved mode.
  await evaluate(`document.querySelector('.window').style.setProperty('--centre-min-width', String(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-6')) * 25) + 'px')`);
  await browser("set", "media", "dark");
  await browser("set", "viewport", "1512", "950");
  await settle();
};

const selectDoor = async () => {
  await evaluate(`(() => { document.querySelector('.rail [data-id="payments"] .name').click(); return true; })()`);
  await browser("wait", ".pane-screen");
  await settle();
};

it("u371_resizing_preserves_the_selection", async () => {
  await openShelf("tree-40", 480, 412);
  await selectDoor();
  const read = () => evaluate(`document.querySelector('.rail [aria-selected="true"]').dataset.id`);
  const before = await read();

  const press = async (edge: string, key: string) => {
    await evaluate(`(() => { document.querySelector('.${edge}-edge').focus(); return true; })()`);
    await browser("press", key);
  };

  await press("shelf", "ArrowLeft");
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("overlay");
  expect(await read()).toEqual(before);
  await press("shelf", "ArrowRight");
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("reserved");
  expect(await read()).toEqual(before);
  // Rail resizing crosses the same floor without replacing the Terminal.
  await press("shelf", "ArrowLeft");
  await settle();
  await press("rail", "ArrowLeft");
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("reserved");
  expect(await read()).toEqual(before);
}, 90_000);

it("u371_scrim_and_escape_close_the_shelf", async () => {
  await openShelf("tree-40", 480, 560);
  await captureViewport();
  await selectDoor();

  if (captureDir("U2892")) {
    await evaluate(`(() => { window.__fake.failNext(-32000, 'Terminal could not open'); document.querySelector('.terminal-new').click(); return true; })()`);
    await browser("wait", ".bubble-failure");
  }

  await toggle();
  await capture("shelf-before");
  await toggle();
  await capture("shelf-open");
  await browser("mouse", "move", "600", "400");
  await browser("mouse", "down", "left");
  await browser("mouse", "up", "left");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  await capture("shelf-closed");
  await toggle();
  await evaluate(`(() => { document.querySelector('.rail .rail-row').focus(); return true; })()`);
  await settle();
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  await evaluate(`(() => { document.querySelector('.terminal-new').focus(); return true; })()`);
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  expect(await evaluate("window.__fake.app.calls.filter(c => c.method === 'terminal.write').length")).toBe(0);
  expect(await evaluate("Boolean(document.querySelector('.shelf-scrim'))")).toBe(false);
}, 90_000);

it("u371_drawer_and_dialog_keep_escape_priority", async () => {
  await openShelf("tree-40", 480, 560);
  await captureViewport();
  await selectDoor();
  await evaluate(`(() => { document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await settle();
  await evaluate(`(() => { document.querySelector('.shelf [aria-label="Add Pad"]').click(); return true; })()`);
  await browser("wait", '.shelf input');
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  expect(await evaluate("Boolean(document.querySelector('.shelf input'))")).toBe(false);
  await evaluate(`(() => { document.activeElement.blur(); document.querySelector('.rail [role=tree]').dispatchEvent(new KeyboardEvent('keydown', {key:'?',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("Boolean(document.querySelector('[role=dialog]'))")).toBe(true);
  await capture("dialog-open");
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("Boolean(document.querySelector('[role=dialog]'))")).toBe(false);
  await capture("dialog-closed");
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
}, 90_000);
