import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u371-browser-"));

const cacheDir = mkdtempSync(join(tmpdir(), "u371-vite-"));

const session = `u371-${process.pid}`;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;

const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));

let server: Awaited<ReturnType<typeof createServer>>;

let main: Awaited<ReturnType<typeof createServer>> | undefined;

beforeAll(async () => {
  server = await createServer({ cacheDir, server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();

  const root = process.env['ROUNDUP_U371_MAIN'];

  if (root) {
    main = await createServer({ root, cacheDir: join(cacheDir, 'main'), server: { port: 0, hmr: false }, logLevel: 'silent' });
    await main.listen();
  }
}, 90_000);

afterAll(async () => {
  await browser("close");
  await server?.close();
  await main?.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

// ResizeObserver delivers geometry before the next paint; frame.toggle flushes the
// hidden Shelf before showing it, and Pane refits on the next frame after settling.
const settle = () => evaluate(`(async () => {
  await new Promise(resolve => requestAnimationFrame(resolve));
  await Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches?.('.shelf, .columns, .drawer')).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`);

const openShelf = async (seed = "tree-40", rail = 288, shelf = 320, width = 1280, scheme = "light", origin = server.resolvedUrls!.local[0]) => {
  await browser("set", "viewport", String(width), "800");
  await browser("set", "media", scheme);
  const url = `${origin}harness.html?seed=${seed}`;
  await browser("open", url);
  await browser("wait", ".window");
  await evaluate(`(() => { localStorage.clear(); localStorage.setItem('roundup:widths:/Users/you/harness', JSON.stringify({rail:${rail}, shelf:${shelf}})); return true; })()`);
  await browser("open", url);
  await browser("wait", seed === "first-run" ? ".window" : ".shelf-tabs");
  await settle();
};

const boxes = () => evaluate<number[][]>(`(() => ['.rail','.centre','.shelf','.drawer'].map(selector => {
  const r = document.querySelector(selector).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, r.width];
}))()`);

const toggle = async () => {
  await evaluate(`(() => { document.querySelector('[aria-label="Hide Shelf"], [aria-label="Show Shelf"]').click(); return true; })()`);
  await settle();
};

const capture = async (id: string, step: string, side = "head") => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(join(dir, side), { recursive: true });
  writeFileSync(join(dir, side, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
  await browser("screenshot", join(dir, side, `${step}.png`));
};

it("u369_the_centre_ends_at_the_shelf_edge", async () => {
  if (main) {
    await openShelf('tree-40', 288, 320, 1280, 'light', main.resolvedUrls!.local[0]);
    await capture('U369', '1280x800-open', 'base');
  }

  await openShelf();
  const [rail, centre, shelf] = await boxes();
  expect(Math.abs(centre![2]! - shelf![0]!)).toBeLessThanOrEqual(1);
  expect(centre![4]).toBe(672);
  expect(rail![4]).toBe(288);
  expect(shelf!.slice(1, 4)).toEqual([0, 1280, 800]);
  await capture("U369", "1280x800-open");
}, 90_000);

it("u369_closed_shelf_releases_its_width", async () => {
  if (main) {
    await openShelf('tree-40', 288, 320, 1280, 'light', main.resolvedUrls!.local[0]);
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

for (const available of [387, 388, 389]) it(`u371_minimum_pane_width_selects_the_mode_${available}`, async () => {
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

for (const overlay of [false,true]) it(`u371_drawer_reserves_width_once_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);
  await evaluate(`(() => { document.querySelector('.shelf [data-todo] .todo-row-button').click(); return true; })()`);
  await settle();
  const before = await boxes();
  expect(Math.abs(before[1]![2]! - before[3]![0]!)).toBeLessThanOrEqual(1);
  expect(before[3]![1]).toBe(0);
  expect(before[3]![3]).toBe(800);
  await browser("press", "Meta+Backslash");
  await settle();
  expect((await boxes()).slice(0, 2)).toEqual(before.slice(0,2));
  expect((await boxes())[3]).toEqual(before[3]);
  await browser("press", "Meta+Backslash");
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

for (const scheme of ["light","dark"]) for (const seed of ["tree-40","agents-10","first-run"]) for (const width of [1280,1440]) it(`u371_checks_hold_with_open_closed_and_fallback_shelf_${scheme}_${seed}_${width}`, async () => {
  const baselines = new Map<string, Checks>();

  for (const side of main ? ['base', 'head'] : ['head']) {
    await openShelf(seed,288,320,width,scheme, (side === 'base' ? main! : server).resolvedUrls!.local[0]);

    for (const state of ["open", "closed", "wide-panels"]) {
      if (state === "closed") await toggle();

      if (state === "wide-panels") {
        await evaluate(`(() => { const rail=document.querySelector('.rail-edge'), shelf=document.querySelector('.shelf-edge'); for (const el of [rail,shelf]) el.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); return true; })()`);
        await settle();
        await toggle();
      }

      const checks = await evaluate<Checks>("window.__checks()");

      if (side === 'base') baselines.set(state, checks);
      else for (const id of CHECK_IDS) {
        const check = checks[id];
        // No passing Check on main may regress; head also keeps every Check green.
        expect(check.status, `${id}: ${JSON.stringify(check)}; main: ${JSON.stringify(baselines.get(state)?.[id])}`).toBe("pass");
      }

      await capture("U371", `${width}x800-${scheme}-${seed}-${state}`, side);
    }
  }
}, 120_000);

for (const overlay of [false, true]) it(`u371_centre_never_crosses_the_sliding_shelf_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);

  const frames = await evaluate<number[][]>(`(async () => {
    const rows=[];
    const sample = () => {
      const shelf=document.querySelector('.shelf'), centre=document.querySelector('.centre');
      rows.push([performance.now(), centre.getBoundingClientRect().right, shelf.getBoundingClientRect().left]);
    };
    document.querySelector('[aria-label="Hide Shelf"]').click();
    let reverse=false;
    await new Promise(resolve => {
      const tick = () => {
        sample();
        if (rows.length===4) {
          document.querySelector('[aria-label="Show Shelf"]').click();
          reverse=true;
        }
        if (reverse && rows.length>4 && !document.getAnimations().some(a => a.effect?.target?.matches?.('.shelf, .columns'))) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return rows;
  })()`);

  expect(frames.length).toBeGreaterThanOrEqual(5);

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

it("u371_checks_hold_with_failure_text_visible", async () => {
  await openShelf();
  await evaluate(`(() => { window.__fake.failNext(-32001,'Injected completion failure preserves the full explanation'); document.querySelector('.shelf .todo-tick:not(:disabled)').click(); return true; })()`);
  await settle();
  const observation = await evaluate<{text: string; calls: unknown}>("({text:document.querySelector('.shelf').textContent,calls:window.__fake.app.calls.slice(-5)})");
  expect(observation.text, JSON.stringify(observation.calls)).toContain('Injected completion failure preserves the full explanation');

  const result = await evaluate<{ visible: boolean; checks: Checks }>(`(() => {
    const el=[...document.querySelectorAll('.shelf p')].find(el=>el.textContent.includes('Injected completion failure preserves the full explanation'));
    const r=el.getBoundingClientRect();
    return {visible:r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight && el.scrollWidth<=el.clientWidth, checks:window.__checks()};
  })()`);

  expect(result.visible).toBe(true);

  for (const [id,check] of Object.entries(result.checks)) expect(check.status, `${id}: ${JSON.stringify(check)}`).toBe("pass");

  await capture("U371", "1280x800-tree-40-failure");
}, 90_000);

it("u371_reduced_motion_and_restore_are_instant", async () => {
  await openShelf();
  await browser("set", "media", "light", "reduced-motion");
  await settle();
  await toggle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  expect((await boxes())[1]![4]).toBe(992);
  expect(await evaluate("document.getAnimations().filter(a=>a.effect?.target?.matches?.('.shelf,.columns')).length")).toBe(0);
  await toggle();
  expect((await boxes())[1]![4]).toBe(672);
  await browser("set", "media", "light");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
  await browser("wait", ".shelf-tabs");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').dataset.animated")).toBe("false");
  expect(await evaluate("document.getAnimations().filter(a=>a.effect?.target?.matches?.('.shelf,.columns')).length")).toBe(0);
  expect((await boxes())[1]![4]).toBe(672);
}, 90_000);

it("u371_resizing_a_reserved_shelf_refits_the_terminal_after_the_drag", async () => {
  await openShelf("agents-10");
  await evaluate(`(() => { document.querySelector('.rail [data-id="agent-4"] .name').click(); return true; })()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate("(() => { window.__fake.app.calls.length=0; return true; })()");
  await browser("mouse", "move", "960", "400");
  await browser("mouse", "down", "left");

  for (const x of [920, 896, 880]) {
    await browser("mouse", "move", String(x), "400");
    await settle();
  }

  expect(await evaluate("window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length")).toBe(0);
  await browser("mouse", "up", "left");
  await settle();
  expect(await evaluate("window.__fake.app.calls.filter(c=>c.method==='terminal.resize').length")).toBe(1);
  expect((await boxes())[2]![4]).toBe(400);
}, 90_000);

for (const scheme of ["light", "dark"]) it(`u371_overlay_scrim_darkens_the_centre_${scheme}`, async () => {
  await openShelf("agents-10", 480, 560, 1280, scheme);
  const color = await evaluate<number[]>(`(() => getComputedStyle(document.querySelector('.shelf-scrim')).backgroundColor.match(/[\\d.]+/g).map(Number))()`);
  expect(color.slice(0, 3)).toEqual([0, 0, 0]);
  expect(color[3]).toBeGreaterThan(0);
  expect(color[3]).toBeLessThan(1);
  await capture("U371", `1280x800-${scheme}-scrim`);
}, 90_000);
