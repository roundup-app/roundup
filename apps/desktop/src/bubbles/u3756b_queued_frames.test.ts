import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { fresh, load, newer } from "./u3756Browser";

for (const path of ["ask", "switcher", "rail-name", "todo-title"]) {
  it(`u3756b_queued_${path}_appearance_yields_to_a_newer_rail_choice`, async () => {
    await fresh();

    if (path === "todo-title") await newer("drawer");

    if (path === "switcher") await holdFrames();

    await read(`window.queuedFocus = []; window.realMicrotask = window.queueMicrotask; window.queueMicrotask = fn => window.queuedFocus.push(fn)`);

    if (path === "ask") await browser("press", "Meta+/");
    else if (path === "switcher") {
      await browser("press", "Meta+k");
      await browser("press", "k");
    } else if (path === "rail-name") await read(`document.querySelector('.rail-row .name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); window.__flush()`);
    else await read(`document.querySelector('.todo-detail-title p[tabindex]').dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); window.__flush()`);
    expect(await read(`window.queuedFocus.length`)).toBeGreaterThan(0);
    await read(`window.newerFocus = document.querySelector('.rail-row[tabindex], .rail-row [tabindex], .rail [role=treeitem][tabindex]'); window.newerFocus.focus(); window.queueMicrotask = window.realMicrotask; window.queuedFocus.splice(0).forEach(fn => fn())`);

    if (path === "switcher") await read(`window.releaseFrames()`);

    // The owner's microtasks and the chooser machine's focus frame have completed before reading focus.
    expect(await read(`document.activeElement === window.newerFocus`)).toBe(true);
  }, 90_000);
}

const loadDense = async () => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row') && !!document.querySelector('#shelf-tab-todos')`);
  await read(`(() => {
    const app = window.__fake.app;
    const start = app.handlers['rail.startDoor'];
    app.handlers['rail.startDoor'] = params => new Promise(resolve => { window.arrive = () => resolve(start(params)); });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    document.querySelector('.rail-actions [data-button="add"]').click();
  })()`);
  await wait(`!!document.querySelector('[role=menuitem][data-value=workstream]')`);
  await browser("click", "[role=menuitem][data-value=workstream]");
  await wait(`!!window.arrive`);
  await read(`window.__fake.app.rpc('todo.move', { id: 1, home: document.querySelector('.rail-row[data-selected]').dataset.id })`);
  await wait(`!!document.querySelector('.todo-row-button')`);
};

const choose = async (surface: string) => { await newer(surface); await read(`window.newFocus = window.newerFocus; window.newText = window.newerText`); };

const holdFrames = async () => read(`(() => {
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  const frames = new Map();
  let next = -1;
  window.requestAnimationFrame = callback => { const id = next--; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { if (!frames.delete(id)) cancel(id); };
  window.releaseFrames = () => new Promise(resolve => {
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    request(time => { for (const callback of frames.values()) callback(time); resolve(frames.size); });
  });
})()`);

// U3756b reworded (accepted change 25): a Select is no appearance path; its list takes focus on opening and gives it back to the trigger as ui-sdk's Select does.
it.each(["initial", "return"])("u3756b_a_select_list_takes_and_returns_focus_%s", async phase => {
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await browser("press", "Meta+Comma");
  await wait(`!!document.querySelector('.settings-view [role=combobox]')`);
  await read(`window.selectTrigger = document.querySelector('.settings-view [role=combobox]'); window.selectTrigger.focus()`);
  await browser("press", "Enter");
  await wait(`!!document.activeElement?.closest('.app-select-list')`);

  if (phase === "return") {
    await browser("press", "Escape");
    await wait(`window.selectTrigger.getAttribute('aria-expanded') === 'false'`);
    expect(await read(`document.activeElement === window.selectTrigger`)).toBe(true);
  }
}, 90_000);

it("u3756b_a_menu_focus_frame_yields_to_a_newer_rail_choice_owner", async () => {
  await loadDense();
  await read(`document.querySelector('.todo-row-button').closest('.shelf-group-body[data-closed]')?.closest('[data-shelf-group]').querySelector('.shelf-group-control').click()`);
  await wait(`!document.querySelector('.todo-row-button').closest('.shelf-group-body[data-closed]')`);
  await wait(`document.querySelector('.todo-row-button').getBoundingClientRect().height > 0`);
  await browser("focus", ".todo-row-button");
  await wait(`document.activeElement?.matches('.todo-row-button')`);
  await holdFrames();
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true, cancelable: true })); document.querySelector('.rail-row').focus(); window.newFocus = document.activeElement;`);
  await wait(`!!document.querySelector('.owner-picker')`);
  expect(await read<number>(`window.releaseFrames()`)).toBeGreaterThan(0);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
}, 90_000);

it("u3756b_a_terminal_name_return_frame_yields_to_the_newer_ask_bar", async () => {
  await load();
  await choose("bubble");
  await browser("dblclick", '.terminal-tab[data-bubble="101"] .terminal-tab-name');
  await wait(`document.activeElement?.matches('.terminal-tab-editor input')`);
  await holdFrames();
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
  await choose("ask");
  expect(await read<number>(`window.releaseFrames()`)).toBeGreaterThan(0);
  expect(await read(`document.activeElement === window.newFocus && window.newFocus.value === window.newText`)).toBe(true);
}, 90_000);

it("u3756b_the_queued_agent_editor_yields_to_the_newer_rail_choice", async () => {
  await loadDense();
  await read(`window.arrive()`);
  await wait(`!!document.querySelector('.pane-screen .xterm')`);
  await read(`(() => {
    const queued = [], queue = window.queueMicrotask;
    window.queueMicrotask = task => queued.push(task);
    try {
      document.querySelector('.rail-row[data-selected]').dispatchEvent(new KeyboardEvent('keydown', {key:'N',code:'KeyN',metaKey:true,shiftKey:true,bubbles:true}));
    } finally { window.queueMicrotask = queue; }
    window.queuedCount = queued.length;
    window.newFocus = document.querySelector('.rail-row[data-selected]');
    window.newFocus.focus();
    queued.forEach(task => queue(task));
  })()`);
  expect(await read(`window.queuedCount`)).toBeGreaterThan(0);
  expect(await read(`!!document.querySelector('.spawn-prompt-field')`)).toBe(true);
  expect(await read(`document.activeElement === window.newFocus`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write')`)).toEqual([]);
}, 90_000);
