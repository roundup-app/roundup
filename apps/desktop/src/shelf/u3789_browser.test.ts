import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const shot = async (id: string, stage: string, step: string) => {
  const checks = await read<Checks>("window.__checks()");
  const directory = captureDir(id);

  if (directory) {
    const folder = join(directory, stage);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${step}.checks.json`), JSON.stringify(checks) + "\n");
    await browser("screenshot", join(folder, `${step}.png`));
    const boxes = await read(`Array.from(document.querySelectorAll('.rail-row, .shelf-row')).map(row => ({id:row.dataset.id ?? row.dataset.todo ?? row.dataset.incarnation, box:row.getBoundingClientRect().toJSON(), name:row.querySelector('.name, .shelf-title, .pad-name')?.getBoundingClientRect().toJSON(), controls:Array.from(row.querySelectorAll('button,input[type=checkbox]')).filter(control => getComputedStyle(control).opacity !== '0' && control.checkVisibility({opacityProperty:true})).map(control => control.getAttribute('aria-label'))}))`);
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

const overview = async () => {
  await browser("click", "[data-todo-root]");
  await browser("eval", "(() => {const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();})()");
  await wait("document.querySelector('.todos-tab')");
};

const dense = async () => {
  await browser("eval", `(async () => {
    const rpc = window.__fake.app.rpc;
    await rpc('todo.update', {id: 1, title: 'T'.repeat(300), body: null});
    await rpc('rail.rename', {id: 'tokens', name: 'A'.repeat(60)});
    await rpc('rail.rename', {id: 'payments', name: 'W'.repeat(60)});
    const made = [];
    for (let i = 0; i < 10; i++) made.push((await rpc('todo.create', {title: 'blocker ' + i, body: null, blockers: null})).id);
    await rpc('todo.setBlockers', {id: 1, blockers: made});
    await rpc('pad.rename', {name: 'a-pad-with-a-very-long-name-here', newName: 'P'.repeat(120), expectedIncarnation: 'fixture-1'});
  })()`);
};

it("u3789a_drag_never_opens", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await load("tree-40");
  await overview();
  await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
  const selector = '.todos-tab [data-todo="1"] .todo-row-button';
  await wait(`document.querySelector('${selector}')`);
  const point = await read<{ x: number; y: number }>(`(() => { const row = document.querySelector('${selector}'); row.scrollIntoView({block:'center'}); const box = row.getBoundingClientRect(); return {x: box.x + box.width / 2, y: box.y + box.height / 2}; })()`);
  await browser("eval", "window.__fake.app.calls.length = 0");
  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(point.x + 8), String(point.y + 8));
  await wait("document.querySelector('[data-dnd-placeholder]')");
  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "up");
  await wait("!document.querySelector('[data-dnd-placeholder]')");
  expect(await read("!!document.querySelector('.drawer[data-open=true], .row-name-editor')")).toBe(false);
  expect(await read("window.__fake.app.calls.filter(call => ['todo.getHistory','todo.readHistory','todo.update'].includes(call.method))")).toEqual([]);
  await shot("U3789a", "head", "drag-release");
}, 120_000);

it("u3789b_u3789d_rendered_rows_and_unchanged_disclosures", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  const baseline = new Map<string, Checks>();

  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    for (const seed of ["tree-40", "agents-10", "empty-project"]) {
      await load(seed, base);
      await overview();
      const checks = await shot("U3789d", base ? "base" : "head", `${seed}-rest`);

      if (base) baseline.set(seed, checks);
      else {
        for (const id of CHECK_IDS) if (baseline.get(seed)?.[id].status === "pass") expect(checks[id].status, `${seed} ${id}`).toBe("pass");
      }

      if (seed === "tree-40") {
        await dense();
        await shot("U3789d", base ? "base" : "head", "dense-rest");
        await browser("mouse", "move", "1", "1");
        await shot("U3789d", base ? "base" : "head", "outside");
      }
    }
  }

  await load("tree-40");
  await overview();
  const directoryVideo = captureDir("U3789d");

  if (directoryVideo) {
    await browser("record", "start", join(directoryVideo, "interaction.webm"));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("window.__fake && document.querySelector('.rail-tree')");
    await overview();
  }

  await dense();
  await wait("document.querySelector('.todos-tab [data-todo=\"1\"]')");
  await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
  const title = '.todos-tab [data-todo="1"] .todo-row-button';
  await browser("mouse", "move", "1", "1");
  await browser("eval", "document.activeElement.blur()");
  await shot("U3789d", "head", "dense-rest");
  await browser("hover", title);
  await shot("U3789d", "head", "dense-hover");
  await browser("focus", title);
  await shot("U3789d", "head", "dense-focus");
  await browser("click", title);
  await shot("U3789d", "head", "dense-selected");
  await browser("eval", `(() => {
    window.__rowMutations = [];
    const groups = document.querySelector('.todos-tab .shelf-groups');
    window.__rowObserver = new MutationObserver(records => window.__rowMutations.push(...records.map(record => ({type: record.type, target: record.target.nodeName}))));
    window.__rowObserver.observe(groups, {subtree: true, childList: true, characterData: true, attributes: true});
    window.__rowFolds = [...groups.querySelectorAll('[data-shelf-group]')].map(group => [group.dataset.shelfGroup, group.getAttribute('aria-expanded')]);
  })()`);
  await browser("click", ".shelf-add");
  await wait("document.activeElement?.matches('.entry-field')");
  await browser("fill", ".todos-tab .entry-field", "twenty characters ok");
  await shot("U3789b", "head", "typing");
  const typing = await read("({mutations: window.__rowMutations, folds: [...document.querySelectorAll('.todos-tab [data-shelf-group]')].map(group => [group.dataset.shelfGroup, group.getAttribute('aria-expanded')]), before: window.__rowFolds})");
  const directory = captureDir("U3789b");

  if (directory) writeFileSync(join(directory, "typing-observation.json"), JSON.stringify(typing) + "\n");
  await browser("eval", "window.__fake.failNext(-32003, 'add busy')");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true, cancelable:true}))");
  await wait("document.querySelector('.todos-tab [role=alert]')?.textContent.includes('add busy')");
  await shot("U3789b", "head", "dense-failure");
  await shot("U3789c", "head", "empty-groups-absent");
  await browser("eval", "window.__rowObserver.disconnect()");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}))");
  await browser("focus", title);
  await browser("press", "F2");
  await wait("document.querySelector('.row-name-editor input')");
  await browser("fill", ".row-name-editor input", "  renamed 日本語 🌱  ");
  await shot("U3789a", "head", "dense-rename");
  await browser("eval", "window.__fake.failNext(-32003, 'name taken')");
  await browser("press", "Enter");
  await wait("document.body.textContent.includes('name taken')");
  await shot("U3789d", "head", "dense-rename-failure");
  await browser("eval", "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}))");
  await wait("!document.querySelector('.row-name-editor') && document.querySelector('.todos-tab').checkVisibility()");
  await browser("scrollintoview", '.todos-tab [data-todo="2"] .todo-row-button');
  await browser("click", '.todos-tab [data-todo="2"] .todo-row-button');
  await shot("U3789d", "head", "before-complete");
  await wait("document.activeElement?.matches('.todos-tab [data-todo=\"2\"] .todo-row-button')");
  await browser("eval", "window.__fake.failNext(-32003, 'locked')");
  await browser("click", '.todos-tab [data-todo="2"] .todo-tick');
  await wait("document.body.textContent.includes('locked')");
  await shot("U3789d", "head", "dense-complete-failure");
  await browser("click", ".shelf-add");
  await browser("fill", ".todos-tab .entry-field", "accepted title");
  await browser("press", "Enter");
  await wait("document.querySelector('.todos-tab .entry-field')?.value === ''");
  await shot("U3789b", "head", "submitted");

  if (directoryVideo) await browser("record", "stop");
}, 300_000);

it("u3789d_focus_reaches_open_and_secondary_actions", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await load("tree-40");
  await overview();
  await browser("eval", "document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
  await browser("focus", '.todos-tab [data-todo="1"] .todo-row-button');
  await browser("press", "Tab");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Open'");
  await shot("U3789d", "head", "focused");
  await browser("press", "Tab");
  await wait("document.activeElement?.matches('.todo-tick')");
  await browser("press", "Shift+Tab");
  await wait("document.activeElement?.getAttribute('aria-label') === 'Open'");
  await browser("press", "Enter");
  await wait("document.querySelector('.drawer[data-open=true]')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'todo.getHistory').length")).toBe(1);
  await browser("press", "Escape");
  await wait("!document.querySelector('.drawer[data-open=true]')");
}, 120_000);
