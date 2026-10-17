import { expect, it } from "vitest";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { shelfBrowser } from "./u371Browser";

const { rig, browser, evaluate, settle, openShelf, boxes, toggle, capture } = shelfBrowser();

it("u369_the_centre_ends_at_the_shelf_edge", async () => {
  if (rig.main) {
    await openShelf('tree-40', 288, 320, 1280, 'light', rig.main.resolvedUrls!.local[0]);
    await capture('U369', '1280x800-open', 'base');
  }

  await openShelf();
  const [rail, centre, shelf] = await boxes();
  expect(Math.abs(centre![2]! - shelf![0]!)).toBeLessThanOrEqual(1);
  expect(centre![4]).toBe(672);
  expect(rail![4]).toBe(288);
  expect(shelf!.slice(1, 4)).toEqual([48, 1280, 800]);
  await capture("U369", "1280x800-open");
}, 90_000);

it("u369_closed_shelf_releases_its_width", async () => {
  if (rig.main) {
    await openShelf('tree-40', 288, 320, 1280, 'light', rig.main.resolvedUrls!.local[0]);
    await toggle();
    await capture('U369', '1280x800-closed', 'base');
  }

  await openShelf();
  const before = await boxes();
  await toggle();
  const after = await boxes();
  expect(after[0]).toEqual(before[0]);
  expect(after[1]!.slice(0, 2)).toEqual(before[1]!.slice(0, 2));
  expect(after[1]![3]).toBe(before[1]![3]);
  expect(after[1]![4]! - before[1]![4]!).toBe(320);
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  await capture("U369", "1280x800-closed");
}, 90_000);

for (const available of [387, 388]) it(`u371_minimum_pane_width_selects_the_mode_${available}`, async () => {
  await openShelf("tree-40", 480, 800 - available);
  const [rail, centre, shelf] = await boxes();
  expect(rail![4]).toBe(480);
  expect(centre![4]).toBe(available === 387 ? 800 : available);
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe(available === 387 ? "overlay" : "reserved");
  expect(await evaluate("Boolean(document.querySelector('.shelf-scrim'))")).toBe(available === 387);

  if (available !== 387) expect(Math.abs(centre![2]! - shelf![0]!)).toBeLessThanOrEqual(1);
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

  const read = await evaluate<{ right: number; pane: number }>(`(() => ({right:document.querySelector('.shelf').getBoundingClientRect().left, pane:document.querySelector('.pane').getBoundingClientRect().right}))()`);

  expect(read.pane).toBeLessThanOrEqual(read.right + 1);
  await capture("U371", "1280x800-door");
}, 90_000);

it("u371_resizing_preserves_the_selection", async () => {
  await openShelf("tree-40", 480, 412);
  await selectDoor();
  const read = () => evaluate(`document.querySelector('.rail [aria-selected="true"]').dataset.id`);
  const before = await read();
  await evaluate(`(() => { const edge = document.querySelector('.shelf-edge'); edge.focus(); edge.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("overlay");
  expect(await read()).toEqual(before);
  await evaluate(`(() => { document.querySelector('.shelf-edge').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("reserved");
  expect(await read()).toEqual(before);
  // Rail resizing crosses the same floor without replacing the Terminal.
  await evaluate(`(() => { document.querySelector('.shelf-edge').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return true; })()`);
  await settle();
  await evaluate(`(() => { document.querySelector('.rail-edge').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("reserved");
  expect(await read()).toEqual(before);
}, 90_000);

it("u371_scrim_and_escape_close_the_shelf", async () => {
  await openShelf("tree-40", 480, 560);
  await selectDoor();
  await toggle();
  await toggle();
  const [rail, centre] = await boxes();
  expect(rail![4]).toBe(480);
  expect(centre![2]).toBe(1280);
  const scrim = await evaluate<number[]>(`(() => { const r=document.querySelector('.shelf-scrim').getBoundingClientRect(); return [r.left,r.top,r.width,r.height]; })()`);
  expect(scrim).toEqual([480,48,800,752]);
  expect(await evaluate("document.elementFromPoint(600,400).className")).toBe("shelf-scrim");
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
