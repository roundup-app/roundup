import { expect, it } from "vitest";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { shelfBrowser } from "./u371_browser";

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

const draft = 'A draft with unicode: \u03bb \ud83c\udf31 ' + 'long line '.repeat(30);

const selectThread = async () => {
  await evaluate(`(() => { document.querySelector('.rail [data-id="payments"] .name').click(); return true; })()`);
  await browser("wait", ".thread-composer textarea");
  await settle();
  await evaluate(`(() => { const input = document.querySelector('.thread-composer textarea'); input.value = ${JSON.stringify(draft)}; input.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  await settle();
};

it("u371_composer_and_thread_remain_visible", async () => {
  await openShelf();
  await selectThread();
  await evaluate(`(async () => { window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'message.sent',data:{id:9000,from:{kind:'user',id:'you',parent:null},to:'payments',kind:'note',body:'x'.repeat(300),replyTo:null,status:'delivered',reason:null,passedFrom:null,at:Date.now()}}); return true; })()`);
  await settle();

  await evaluate(`(() => { document.querySelector('.thread [aria-label="More"]').click(); return true; })()`);
  await settle();

  await evaluate(`(() => { [...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.includes('All Messages')).click(); return true; })()`);
  await settle();

  // U196 clamps the user's Message to two lines; inspect its full wrapping after Read more.
  await evaluate(`(() => { document.querySelector('.thread-read-more').click(); return true; })()`);
  await settle();
  const checks = await evaluate<Checks>("window.__checks()");

  for (const id of CHECK_IDS) expect(checks[id].status, `${id}: ${JSON.stringify(checks[id])}`).toBe("pass");

  const read = await evaluate<{ right: number; controls: number[]; scroll: number[][]; text: string }>(`(() => {
    const shelf = document.querySelector('.shelf').getBoundingClientRect();
    const thread = document.querySelector('.thread');
    return {right:shelf.left, controls:[...thread.querySelectorAll('textarea, button, input')].map(el => el.getBoundingClientRect().right),
      scroll:[thread, document.querySelector('.thread-composer textarea')].map(el => [el.scrollWidth,el.clientWidth]), text:thread.textContent};
  })()`);

  expect(read.controls.every(right => right <= read.right + 1)).toBe(true);
  expect(read.scroll.every(([scroll, client]) => scroll! <= client! + 1)).toBe(true);
  expect(read.text).toContain('x'.repeat(300));
  await capture("U371", "1280x800-thread-draft");
}, 90_000);

it("u371_resizing_preserves_the_draft_and_selection", async () => {
  await openShelf("tree-40", 480, 412);
  await selectThread();
  const read = () => evaluate(`(() => ({draft:document.querySelector('.thread-composer textarea').value,selected:document.querySelector('.rail [aria-selected="true"]').dataset.id,scroll:document.querySelector('.thread-feed').scrollTop}))()`);
  await evaluate(`(() => {
    for (let n=0;n<40;n++) window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'message.sent',data:{id:9100+n,from:{kind:'user',id:'you',parent:null},to:'payments',kind:'note',body:'Line '+n,replyTo:null,status:'delivered',reason:null,passedFrom:null,at:Date.now()+n}});
    document.querySelector('.thread [aria-label="More"]').click(); return true;
  })()`);
  await settle();
  await evaluate(`(() => { [...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.includes('All Messages')).click(); return true; })()`);
  await settle();
  await evaluate(`(() => { document.querySelector('.thread-feed').scrollTop=100; return true; })()`);
  await settle();
  const before = await read();
  expect(await evaluate("document.querySelector('.thread-feed').scrollTop")).toBe(100);
  await evaluate(`(() => { const edge = document.querySelector('.shelf-edge'); edge.focus(); edge.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("overlay");
  expect(await read()).toEqual(before);
  await evaluate(`(() => { document.querySelector('.shelf-edge').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("reserved");
  expect(await read()).toEqual(before);
  // Rail resizing crosses the same floor without replacing the Thread.
  await evaluate(`(() => { document.querySelector('.shelf-edge').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return true; })()`);
  await settle();
  await evaluate(`(() => { document.querySelector('.rail-edge').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("document.querySelector('.window').dataset.shelfMode")).toBe("reserved");
  expect(await read()).toEqual(before);
}, 90_000);

it("u371_scrim_and_escape_close_without_losing_input", async () => {
  await openShelf("tree-40", 480, 560);
  await selectThread();
  await toggle();
  await evaluate(`(() => { document.querySelector('.thread-composer textarea').focus(); return true; })()`);
  await settle();
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
  expect(await evaluate("document.querySelector('.thread-composer textarea').value")).toBe(draft);
  expect(await evaluate("document.activeElement === document.querySelector('.thread-composer textarea')")).toBe(true);
  await toggle();
  await evaluate(`(() => { document.querySelector('.rail [role=treeitem]').focus(); return true; })()`);
  await settle();
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  await evaluate(`(() => { document.querySelector('.thread-composer textarea').focus(); return true; })()`);
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  expect(await evaluate("document.querySelector('.thread-composer textarea').value")).toBe(draft);
  expect(await evaluate("window.__fake.app.calls.filter(c => c.method === 'message.send').length")).toBe(0);
  expect(await evaluate("Boolean(document.querySelector('.shelf-scrim'))")).toBe(false);
}, 90_000);

it("u371_drawer_and_dialog_keep_escape_priority", async () => {
  await openShelf("tree-40", 480, 560);
  await selectThread();
  await evaluate(`(() => { document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await settle();
  await evaluate(`(() => { document.querySelector('.shelf [aria-label="Add Pad"]').click(); return true; })()`);
  await browser("wait", '.shelf input');
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  expect(await evaluate("Boolean(document.querySelector('.shelf input'))")).toBe(false);
  await evaluate(`(() => { document.querySelector('.thread-composer textarea').blur(); document.querySelector('.rail [role=tree]').dispatchEvent(new KeyboardEvent('keydown', {key:'?',bubbles:true})); return true; })()`);
  await settle();
  expect(await evaluate("Boolean(document.querySelector('[role=dialog]'))")).toBe(true);
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("Boolean(document.querySelector('[role=dialog]'))")).toBe(false);
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  expect(await evaluate("document.querySelector('.thread-composer textarea').value")).toBe(draft);
}, 90_000);
