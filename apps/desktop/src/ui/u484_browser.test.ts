import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, closeBrowser, openBrowser, origin, read } from "./u484_support";

beforeAll(openBrowser, 90_000);

afterAll(closeBrowser);


const load = async (dense = false, query = dense ? "?dense" : "") => {
  await browser("open", new URL(`${new URL("./u484Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html")}${query}`, origin).href);
  await browser("wait", "--fn", `document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])').length === ${dense ? 40 : 3}`);
};

const order = () => read<string[]>(`[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id)`);

// A pointer drag moves no row in the DOM: the other rows make room by translate, so the order it previews is the order the rows show in.
const shownOrder = () => read<string[]>(`[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(el => el.dataset.id)`);

const committed = async (value: string, count = 1) => {
  await browser("wait", "--fn", `document.querySelector('[aria-label="Commits"]').textContent === '${count}'`);
  expect(await read<string>(`document.querySelector('[aria-label="Committed order"]').textContent`)).toBe(value);
  expect((await order()).join(",")).toBe(value);
  expect(await read<string>(`document.querySelector('[aria-label="Commits"]').textContent`)).toBe(String(count));
};

const capture = async (id: string, name: string) => {
  const directory = captureDir(id);

  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await browser("screenshot", join(directory, `${name}.png`));
  writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
};

const drag = async (id: string, target: string) => {
  const point = async (selector: string) => read<{ x: number; y: number }>(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
  const start = await point(`[data-id="${id}"] span`);
  await browser("mouse", "move", String(Math.round(start.x)), String(Math.round(start.y)));
  await browser("mouse", "down");
  await browser("mouse", "move", String(Math.round(start.x + 15)), String(Math.round(start.y)));
  await browser("wait", "--fn", `document.querySelector('[data-id="${id}"]').dataset.dragging === 'true'`);
  const end = await point(`[data-id="${target}"] span`);

  await browser("mouse", "move", String(Math.round(end.x)), String(Math.round(end.y)));
};

it("u490a_original_place_drop_makes_no_commit", async () => {
  await load();

  const origin = await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector('[data-id="C"] span').getBoundingClientRect();
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
  })()`);

  await browser("mouse", "move", String(origin.x), String(origin.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(origin.x), String(origin.y - 12));
  await browser("wait", "--fn", `document.querySelector('[data-id=C]').dataset.dragging === 'true'`);
  await browser("mouse", "move", String(origin.x), String(origin.y));
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[data-id=C]').dataset.dragging === 'false' && !document.querySelector('.sortable-slot')`);
  expect(await order()).toEqual(["A", "B", "C"]);
  expect(await read<number>(`Number(document.querySelector('[aria-label=Commits]').textContent)`)).toBe(0);
  expect(await read<string>(`document.activeElement?.dataset.id`)).toBe("C");
}, 30_000);

it("u484_external_drop", async () => {
  const outside = async () => {
    const point = await read<{ x: number; y: number }>(`(() => { const rect = document.querySelector('[data-outside]').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);

    for (const step of [0.25, 0.5, 0.75, 1]) await browser("mouse", "move", String(Math.round(28 + (point.x - 28) * step)), String(Math.round(20 + (point.y - 20) * step)));
    await browser("wait", "--fn", `document.querySelector('[data-outside]').hasAttribute('data-drop')`);
  };

  const dropped = () => read<string>(`document.querySelector('[aria-label=Dropped]').textContent`);

  await load(false, "?external");
  await drag("A", "A");
  await outside();
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[aria-label=Dropped]').textContent === 'A>Rail'`);
  expect(await read<number>(`Number(document.querySelector('[aria-label=Commits]').textContent)`)).toBe(0);
  expect(await read<boolean>(`document.querySelector('[data-outside]').hasAttribute('data-drop')`)).toBe(false);
  expect(await order()).toEqual(["A", "B", "C"]);
  await browser("wait", "--fn", `document.activeElement?.dataset.id === 'A'`);

  await load(false, "?external");
  await drag("A", "A");
  await outside();
  await browser("press", "Escape");
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[data-id=A]').dataset.dragging === 'false'`);
  expect(await dropped()).toHaveLength(0);
  expect(await read<number>(`Number(document.querySelector('[aria-label=Commits]').textContent)`)).toBe(0);
  expect(await read<boolean>(`document.querySelector('[data-outside]').hasAttribute('data-drop')`)).toBe(false);

  await load(false, "?external");
  await drag("A", "C");
  await browser("mouse", "up");
  await committed("B,C,A");
  expect(await dropped()).toHaveLength(0);
}, 90_000);

// U3800a: one drop look's behaviour — pointer drag, Escape and a following click — through the installed shared Sortable. U7276c's `u7276c_*` prove the moves by key that replaced the keyboard lift.
it("u3800a_one_drag_fixture", async () => {
  const idle = `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',') === 'A,B,C' && document.querySelector('[data-id=A]').dataset.dragging === 'false'`;
  const commits = () => read<number>(`Number(document.querySelector('[aria-label=Commits]').textContent)`);
  const focusedA = () => browser("wait", "--fn", `document.activeElement?.dataset.id === 'A'`);

  await load();
  await drag("A", "C");
  await browser("wait", "--fn", `document.querySelector('.sortable-fixture').dataset.sortableIndex === '2'`);
  // U3800a commissions this one assertion: the order the rows show mid-drag, since a pointer drag moves no row in the DOM.
  // oxlint-disable-next-line anti-slop/no-new-web-assertions
  expect(await shownOrder()).toEqual(['B', 'C', 'A']);
  await browser("press", "Escape");
  await browser("mouse", "up");
  await browser("wait", "--fn", idle);
  expect(await commits()).toBe(0);
  await focusedA();

  await drag("A", "C");
  await browser("mouse", "up");
  await committed("B,C,A");
  await browser("click", '[aria-label="Inspect A"]');
  await browser("wait", "--fn", `document.querySelector('[aria-label=Actions]').textContent === '1'`);
  expect(await commits()).toBe(1);

  await load();
  const handle = await read<{x:number; y:number}>(`(() => { const b=document.querySelector('[data-id="A"] span').getBoundingClientRect(); return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}; })()`);

  await browser("mouse", "move", String(handle.x), String(handle.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(handle.x + 2), String(handle.y));
  await browser("mouse", "up");
  expect(await read<number>(`Number(document.querySelector('[aria-label=Actions]').textContent)`)).toBe(0);
  expect(await commits()).toBe(0);
  expect(await read<boolean>(`(() => {
    const row = document.querySelector('[data-id=A]');
    const transfer = new DataTransfer(); transfer.items.add(new File(['hello'], 'example.txt', {type: 'text/plain'}));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    row.dispatchEvent(over); row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return over.defaultPrevented;
  })()`)).toBe(true);
  await browser("wait", "--fn", `document.querySelector('[aria-label=Files]').textContent === 'example.txt'`);
  expect(await commits()).toBe(0);
  expect(await read<number>(`document.querySelectorAll('[data-dragging=true]').length`)).toBe(0);

  // Commissioned Shelf Pad consumer: a pointer drag from the Pad's row uses the real holder and RPC.
  await browser("open", new URL("harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await browser("wait", "--fn", "!!document.querySelector('#shelf-tab-pads')");
  await browser("wait", "--fn", "!document.querySelector('.rail-row[data-selected]')");
  await browser("click", "#shelf-tab-pads");
  await browser("wait", "--fn", "!!document.querySelector('.pads-tab [data-shelf-group] .shelf-group-control')");
  await browser("wait", "--fn", "document.querySelectorAll('.pads-tab .pad-name').length >= 2");
  // U2744a: a Pad list is the one a group's own rows form, so Agent subgroups never mix into the order.
  const ownList = "[...document.querySelectorAll('.pads-tab .shelf-list')].find(list => list.querySelectorAll('[data-pad]').length >= 2)";
  const padOrder = `[...${ownList}.querySelectorAll('[data-pad]')].map(row=>row.dataset.pad)`;
  const names = await read<string[]>(padOrder);
  const first = names[0]!;
  const second = names[1]!;
  const grip = (name: string) => `.pads-tab [data-pad=${JSON.stringify(name)}] .pad-name`;
  const padCalls = "window.__fake.app.calls.filter(c=>c.method==='pad.reorder')";
  const start = await read<{x:number;y:number}>(`(() => {const el=document.querySelector(${JSON.stringify(grip(first))});el.scrollIntoView({block:"nearest"});const b=el.getBoundingClientRect();return {x:Math.round(b.x+8),y:Math.round(b.y+b.height/2)}})()`);
  await browser("batch", "--bail", `mouse move ${start.x} ${start.y}`, "mouse down", `mouse move ${start.x} ${start.y + 12}`);
  await browser("wait", "--fn", "!!document.querySelector('[data-dnd-placeholder]')");
  await capture("U3800a", "pad-lift");
  const end = await read<{x:number;y:number}>(`(() => {const g=document.querySelector(${JSON.stringify(grip(second))});const b=g.getBoundingClientRect();const lift=parseFloat(getComputedStyle(g.closest('[data-pad]')).translate.split(' ')[1])||0;return {x:Math.round(b.x+8),y:Math.round(b.y+b.height/2-lift)}})()`);
  await browser("mouse", "move", String(end.x), String(end.y));
  await browser("wait", "--fn", "document.querySelector('.pads-tab .shelf-list[data-sortable-index]')?.dataset.sortableIndex === '1'");
  await browser("mouse", "up");
  await browser("wait", "--fn", `${padCalls}.length===1 && ${padOrder}[0]===${JSON.stringify(second)}`);
  const accepted = await read<string[]>(padOrder);
  expect(accepted).toEqual([second, first, ...names.slice(2)]);
  expect(await read<string[]>(`(async()=> (await window.__fake.app.rpc('pad.list',null)).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>p.name))()`)).toEqual(accepted);
  expect(await read<string>(`${padCalls}[0].params.name`)).toBe(first);
  expect(await read<unknown[]>("window.__fake.app.calls.filter(c=>['pad.rename','pad.write','pad.setOwner'].includes(c.method))")).toEqual([]);
  expect(await read<number>("document.querySelectorAll('[role=dialog],.pad-body').length")).toBe(0);
  await capture("U3800a", "pad-accepted");
  await browser("focus", grip(first));
  await browser("press", "Enter");
  await browser("wait", "--fn", "!!document.querySelector('.pad-body')");
  expect(await read<number>(`${padCalls}.length`)).toBe(1);

  // The same session exercises native path routing through the real App and fake event seam.
  await browser("open", new URL("harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await browser("wait", "--fn", "!!document.querySelector('.rail-row[data-id=tokens]')");
  // Hover actions cover the name midpoint; select through the fixed state column.
  await browser("click", ".rail-row[data-id=tokens] .row-state");
  await browser("wait", "--fn", "document.querySelector('.pane-body .xterm') !== null");

  const feed = (phase: string, paths: string[] = []) => read(`(() => {
    const b = document.querySelector('.pane-body').getBoundingClientRect();
    window.__fake.app.dropFiles({phase:${JSON.stringify(phase)},paths:${JSON.stringify(paths)},x:b.left+b.width/2,y:b.top+b.height/2});
    return true;
  })()`);

  for (const id of ["tokens", "migrate"]) {
    await read(`(() => {
      const box = document.querySelector('.rail-row[data-id="${id}"]').getBoundingClientRect();
      window.__fake.app.dropFiles({phase:'over',paths:[],x:box.x + box.width / 2,y:box.y + box.height / 2});
      return true;
    })()`);
    expect(await read<string[]>(`[...document.querySelectorAll('[data-drop=hover]')].map(row => row.dataset.id)`)).toEqual([id]);
  }

  // Rail hover can open its target after U348's hold; leave it and choose the starting pane explicitly.
  await feed("leave");
  await browser("click", ".rail-row[data-id=tokens] .row-state");
  await browser("wait", "--fn", "document.querySelector('.rail-row[data-selected]')?.dataset.id === 'tokens'");
  await feed("over");
  await browser("wait", "--fn", "!!document.querySelector('.pane-body.drop-over')");
  expect(await read<number>("document.querySelectorAll('.drop-over,[data-drop=hover]').length")).toBe(1);
  await capture("U3800b", "centre-hover");
  await feed("leave");
  expect(await read<number>("document.querySelectorAll('.drop-over,[data-drop=hover]').length")).toBe(0);
  await feed("over");
  await browser("click", ".rail-row[data-id=migrate] .row-state");
  await browser("wait", "--fn", "document.querySelector('.rail-row[data-selected]')?.dataset.id === 'migrate'");
  expect(await read<number>("document.querySelectorAll('.drop-over').length")).toBe(0);
  await feed("over");
  const writes = "window.__fake.app.calls.filter(c=>c.method==='terminal.write').map(c=>({id:c.params.id,text:atob(c.params.data)}))";
  const before = await read<unknown[]>(writes);
  await feed("drop");
  expect(await read<unknown[]>(writes)).toEqual(before);
  await feed("drop", ["/Users/me/My Pics/it's.png", "/Users/me/two.txt"]);
  await browser("wait", "--fn", `${writes}.length === ${before.length + 1}`);
  expect((await read<{id:string; text:string}[]>(writes)).slice(before.length)).toEqual([
    {id:"t-migrate",text:"'/Users/me/My Pics/it'\\''s.png' '/Users/me/two.txt' "},
  ]);
  expect(await read<number>("document.querySelectorAll('.drop-over,[data-drop=hover]').length")).toBe(0);
  await read(`(() => {window.__fake.app.dropFiles({phase:'drop',paths:['/tmp/no.txt'],x:-1,y:-1});return true})()`);
  expect(await read<unknown[]>(writes)).toHaveLength(before.length + 1);
  expect(await read<unknown[]>("window.__fake.app.calls.filter(c=>c.method==='rail.move'||c.method==='todo.move')")).toEqual([]);
}, 90_000);

it("u484_scroll_and_stop", async () => {
  await load(true);
  const initial = Array.from({ length: 40 }, (_, index) => String(index + 1));
  await drag("1", "4");
  const edge = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('.sortable-fixture').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 2 }; })()`);
  await browser("mouse", "move", String(Math.round(edge.x)), String(Math.round(edge.y)));
  await browser("wait", "--fn", `document.querySelector('.sortable-fixture').scrollTop > 160`);
  await browser("press", "Escape");
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[data-id="1"]').dataset.dragging === 'false' && document.activeElement?.dataset.id === '1'`);
  expect(await order()).toEqual(initial);
  expect(await read<number>(`Number(document.querySelector('[aria-label=Commits]').textContent)`)).toBe(0);

  const stopped = () => read<number>(`new Promise(resolve => {
    const list = document.querySelector('.sortable-fixture');
    let events = 0;
    let frames = 0;
    const count = () => { events += 1; };
    list.addEventListener('scroll', count);
    const sample = () => {
      if (++frames < 10) return requestAnimationFrame(sample);
      list.removeEventListener('scroll', count);
      resolve(events);
    };
    requestAnimationFrame(sample);
  })`);

  // U484 observes stopped auto-scroll across ten frames after cancellation/release; scroll events prove the behavior without asserting geometry.
  expect(await stopped()).toBe(0);
  await load(true);
  await drag("1", "4");
  await browser("mouse", "move", String(Math.round(edge.x)), String(Math.round(edge.y)));
  await browser("wait", "--fn", `document.querySelector('.sortable-fixture').scrollTop > 160`);
  await browser("mouse", "move", String(Math.round(edge.x)), String(Math.round(edge.y / 2)));
  await browser("wait", "--fn", `Number(document.querySelector('.sortable-fixture').dataset.sortableIndex) > 4`);
  expect(await stopped()).toBe(0);
  const preview = initial.filter(id => id !== "1");
  preview.splice(await read<number>(`Number(document.querySelector('.sortable-fixture').dataset.sortableIndex)`), 0, "1");
  expect(preview.indexOf("1")).toBeGreaterThan(4);
  await browser("mouse", "up");
  await committed(preview.join(","));
  expect(await stopped()).toBe(0);
}, 90_000);
