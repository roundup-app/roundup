import { expect, it } from "vitest";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { shelfBrowser } from "./u371Browser";

const { rig, browser, evaluate, settle, openShelf, toggle, capture } = shelfBrowser();

it("u369_closed_shelf_releases_its_width", async () => {
  if (rig.main) {
    await openShelf('tree-40', 288, 320, 1280, 'light', rig.main.resolvedUrls!.local[0]);
    await toggle();
    await capture('U369', '1280x800-closed', 'base');
  }

  await openShelf();
  await toggle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  await capture("U369", "1280x800-closed");
}, 90_000);

for (const available of [387, 388]) it(`u371_minimum_pane_width_selects_the_mode_${available}`, async () => {
  await openShelf("tree-40", 480, 800 - available);
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe(available === 387 ? "overlay" : "reserved");
  expect(await evaluate("Boolean(document.querySelector('.shelf-scrim'))")).toBe(available === 387);
}, 90_000);

const selectDoor = async () => {
  await evaluate(`(() => { document.querySelector('.rail [data-id="payments"] .name').click(); return true; })()`);
  await browser("wait", ".pane-screen");
  await settle();
};

it("u371_terminal_remains_visible", async () => {
  await openShelf();
  await selectDoor();
  const checks = await evaluate<Checks>("window.__checks()");

  for (const id of CHECK_IDS) expect(checks[id].status, `${id}: ${JSON.stringify(checks[id])}`).toBe("pass");

  await capture("U371", "1280x800-door");
}, 90_000);

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
  await selectDoor();
  await toggle();
  await toggle();
  await capture("U371", "1280x800-overlay");
  await browser("mouse", "move", "600", "400");
  await browser("mouse", "down", "left");
  await browser("mouse", "up", "left");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
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
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("Boolean(document.querySelector('[role=dialog]'))")).toBe(false);
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
}, 90_000);
