import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "./u371Browser";

const { rig, browser, evaluate, settle, openShelf, boxes, toggle } = shelfBrowser();

for (const overlay of [false,true]) it(`u371_drawer_reserves_width_once_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);
  await evaluate(`(() => { document.querySelector('.shelf [data-todo] .todo-row-button').click(); return true; })()`);
  await settle();
  const before = await boxes();
  expect(Math.abs(before[1]![2]! - before[3]![0]!)).toBeLessThanOrEqual(1);
  expect(before[3]![1]).toBe(38);
  expect(before[3]![3]).toBe(800);
  await browser("press", "Meta+k");
  await browser("press", "s");
  await settle();
  expect((await boxes()).slice(0, 2)).toEqual(before.slice(0,2));
  expect((await boxes())[3]).toEqual(before[3]);
  await browser("press", "Meta+k");
  await browser("press", "s");
  await settle();
  expect((await boxes()).slice(0, 2)).toEqual(before.slice(0,2));
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  expect(await evaluate("document.querySelector('.drawer').dataset.open")).toBe("false");
  const after = await boxes();
  expect(after[1]![4]).toBe(overlay ? 800 : 672);
}, 90_000);

for (const overlay of [false,true]) it(overlay ? "u371_overlay_sends_no_terminal_resize" : "u371_terminal_resizes_once_per_reserved_slide", async () => {
  await openShelf("agents-10", overlay ? 480 : 288, overlay ? 560 : 320);
  await evaluate(`(() => { document.querySelector('.rail [data-id="agent-4"] .name').click(); return true; })()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate("(() => { window.__fake.app.calls.length=0; return true; })()");

  for (let n=0;n<2;n++) {
    await toggle();
    const calls = await evaluate<{method:string;params:unknown}[]>("window.__fake.app.calls");
    // U408 polls resources independently every 2 s; all other calls belong to this toggle.
    expect(calls.filter(c => c.method !== "project.resources").map(c=>c.method), JSON.stringify(calls)).toEqual(overlay ? [] : Array(n+1).fill("terminal.resize"));
  }
}, 90_000);

for (const overlay of [false, true]) it(`u371_centre_never_crosses_the_sliding_shelf_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);

  const frames = await evaluate<number[][]>(`(async () => {
    const rows=[];
    const start=document.querySelector('.shelf').getBoundingClientRect().left;
    const deadline=performance.now()+5000;
    const sample = () => {
      const shelf=document.querySelector('.shelf'), centre=document.querySelector('.centre');
      rows.push([performance.now(), centre.getBoundingClientRect().right, shelf.getBoundingClientRect().left]);
    };
    document.querySelector('[aria-label="Hide work items"]').click();
    let reverse=false;
    await new Promise((resolve, reject) => {
      const tick = () => {
        sample();
        if (performance.now()>deadline) {
          reject(new Error('Shelf did not complete its interrupted slide'));
          return;
        }
        // Reverse only after the rendered Shelf moves; frame count does not
        // acknowledge frame.toggle's deferred start under a busy browser.
        if (!reverse && rows.at(-1)[2]>start+1) {
          document.querySelector('[aria-label="Show work items"]').click();
          reverse=true;
        }
        if (reverse && !document.getAnimations().some(a => a.effect?.target?.matches?.('.shelf, .columns'))) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return rows;
  })()`);

  expect(frames.length).toBeGreaterThanOrEqual(2);

  if (overlay) expect(frames.every(row => row[1] === 1280)).toBe(true);
  else {
    expect(frames.every(row => row[1]! <= row[2]! + 1)).toBe(true);
    expect(Math.max(...frames.map(row => row[1]!))).toBeGreaterThan(960);
    expect(frames.at(-1)![1]).toBe(960);
  }

  const timing = await evaluate<string[]>(`(() => { const style=getComputedStyle(document.querySelector('.shelf')); return [style.transitionProperty,style.transitionDuration,style.transitionTimingFunction]; })()`);

  expect(timing).toEqual(["transform", "0.18s", "ease-out"]);

  const dir = captureDir("U371");

  if (dir) {
    mkdirSync(join(dir, "head"), { recursive: true });
    writeFileSync(join(dir, "head", `slide-${overlay ? 'overlay' : 'reserved'}-frames.json`), JSON.stringify(frames) + "\n");
  }
}, 90_000);

for (const overlay of [false, true]) it(`u371_reduced_motion_and_restore_are_instant_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);
  await browser("set", "media", "light", "reduced-motion");
  await settle();
  await toggle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  expect((await boxes())[1]![4]).toBe(overlay ? 800 : 992);
  expect(await evaluate("document.getAnimations().filter(a=>a.effect?.target?.matches?.('.shelf,.shelf-scrim,.columns')).length")).toBe(0);
  await toggle();
  expect((await boxes())[1]![4]).toBe(overlay ? 800 : 672);
  await browser("set", "media", "light");
  await browser("open", `${rig.server.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
  await browser("wait", ".shelf-tabs");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').dataset.animated")).toBe("false");
  expect(await evaluate("document.getAnimations().filter(a=>a.effect?.target?.matches?.('.shelf,.shelf-scrim,.columns')).length")).toBe(0);
  expect((await boxes())[1]![4]).toBe(overlay ? 800 : 672);
}, 90_000);
