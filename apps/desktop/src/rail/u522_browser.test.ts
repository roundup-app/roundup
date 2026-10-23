import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("set", "media", "light");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`document.querySelector('[data-id="tokens"]') && window.__fake`);
};

const moves = () => read<unknown[]>(`window.__fake.app.calls.filter(call => call.method === 'rail.move').map(call => call.params)`);

const box = (id: string) => read<{ x: number; y: number; top: number; bottom: number; left: number }>(`(() => { const r = document.querySelector('[data-part="item"][data-id="${id}"], [data-part="branch-control"][data-id="${id}"], [data-id="${id}"] > [data-part="branch-control"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left }; })()`);

const order = () => read<string[]>(`[...document.querySelectorAll('.rail-tree [data-id]:not([data-dnd-placeholder])')].map(el => el.dataset.id).filter((id, at, all) => all.indexOf(id) === at)`);

const mouse = (action: string, x?: number, y?: number) => browser("mouse", action, ...(x === undefined ? [] : [String(Math.round(x)), String(Math.round(y!))]));

/** Presses `id`'s row, then moves the pointer to the gap `depth` indents right of the row's left edge, `below` the bottom of `to`. */
const dragBelow = async (id: string, to: string, shift = 0) => {
  const from = await box(id);
  const target = await box(to);

  await mouse("move", from.x, from.y);
  await mouse("down");
  await mouse("move", from.x + 6, from.y + 6);
  await wait(`document.querySelector('[data-id="${id}"]').dataset.lifted === 'true' || document.querySelector('[data-dnd-placeholder]')`);
  await mouse("move", from.x + 6 + shift, target.bottom + 2);
  await mouse("move", from.x + shift, target.bottom + 2);
};

const settle = (calls: number) => wait(`window.__fake.app.calls.filter(call => call.method === 'rail.move').length >= ${calls} && !document.querySelector('[data-dnd-placeholder]')`);

it("u522_pointer_move_calls_rail_move", async () => {
  await load();
  await dragBelow("tokens", "logins");
  expect(await read<boolean>(`document.querySelector('.drop-line') !== null`)).toBe(true);
  await mouse("up");
  await settle(1);
  expect(await moves()).toEqual([{ id: "tokens", parent: "auth", index: 1 }]);
  expect(await read<boolean>(`document.querySelector('.drop-line') === null`)).toBe(true);
}, 90_000);

it("u522_cancel_calls_nothing", async () => {
  await load();
  const before = await order();
  await dragBelow("tokens", "logins");
  await browser("press", "Escape");
  await mouse("up");
  await wait(`!document.querySelector('[data-dnd-placeholder]')`);
  expect(await moves()).toEqual([]);
  expect(await order()).toEqual(before);

  await dragBelow("tokens", "logins");
  await mouse("move", 1270, 400);
  await mouse("up");
  await wait(`!document.querySelector('[data-dnd-placeholder]')`);
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_conflict_restores_the_row", async () => {
  await load();
  const before = await order();
  await dragBelow("tokens", "logins");
  await read<void>(`window.__fake.failNext(-32000, 'CONFLICT: cannot move under an agent')`);
  await mouse("up");
  await wait(`[...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('CONFLICT: cannot move under an agent'))`);
  expect(await order()).toEqual(before);
  expect(await read<boolean>(`document.querySelector('.drop-line') === null`)).toBe(true);
}, 90_000);

it("u522_edge_scroll_reaches_an_offscreen_row", async () => {
  await load();
  const from = await box("tokens");
  const edge = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('.rail-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 4 }; })()`);

  await mouse("move", from.x, from.y);
  await mouse("down");
  await mouse("move", from.x + 6, from.y + 6);
  await mouse("move", edge.x, edge.y);
  await wait(`document.querySelector('.rail-scroll').scrollTop > 100`);
  await browser("press", "Escape");
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_keyboard_move", async () => {
  await load();
  await browser("focus", `[data-part="item"][data-id="tokens"]`);
  await browser("press", "Space");
  await wait(`document.querySelector('[data-dnd-placeholder]')`);
  await browser("press", "ArrowDown");
  await browser("press", "ArrowRight");
  await browser("press", "Space");
  await settle(1);
  expect(await moves()).toEqual([{ id: "tokens", parent: "auth", index: 1 }]);
  await wait(`document.activeElement?.dataset.id === 'tokens'`);
}, 90_000);

it("u522_enter_still_selects_the_focused_row", async () => {
  await load();
  await browser("focus", `[data-part="item"][data-id="tokens"]`);
  await browser("press", "Enter");
  await wait(`document.querySelector('[data-part="item"][data-id="tokens"]').getAttribute('aria-selected') === 'true'`);
  expect(await read<boolean>(`document.querySelector('[data-dnd-placeholder]') === null`)).toBe(true);
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_file_drop_coexists", async () => {
  await load();
  expect(await read<boolean>(`(() => {
    const row = document.querySelector('[data-part="item"][data-id="tokens"]');
    const transfer = new DataTransfer(); transfer.items.add(new File(['hello'], 'example.txt', { type: 'text/plain' }));
    row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    row.dispatchEvent(over);
    return over.defaultPrevented || document.querySelector('[data-dnd-placeholder]') === null;
  })()`)).toBe(true);
  expect(await read<number>(`document.querySelectorAll('[data-dnd-placeholder]').length`)).toBe(0);
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_a_press_on_a_button_starts_no_drag", async () => {
  await load();
  const chevron = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-id="backend"] .rail-chevron, .rail-chevron').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  await mouse("move", chevron.x, chevron.y);
  await mouse("down");
  await mouse("move", chevron.x + 4, chevron.y + 80);
  expect(await read<boolean>(`document.querySelector('[data-dnd-placeholder]') === null`)).toBe(true);
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

it("u3515c_rail_nesting_excludes_self_descendants_and_unchanged_placement", async () => {
  await load();
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  // backend contains auth, which contains tokens. None is a destination for backend.
  for (const target of ["backend", "auth", "tokens"]) {
    await dragBelow("backend", target, 40);
    await mouse("up");
    await wait("!document.querySelector('[data-dnd-placeholder]')");
    expect(await moves()).toEqual([]);
  }

  await dragBelow("backend", "agent-31", -100);
  await mouse("up");
  await settle(1);
  expect(await moves()).toEqual([expect.objectContaining({ id: "backend", parent: null })]);
  expect((await order()).indexOf("backend")).toBeGreaterThan(0);
}, 90_000);

it("u3515_rendered_target_pickers", async () => {
  const { openLane } = await import("../todos/laneBrowser");
  const lane = await openLane(1512, "dark", "u3515");

  try {
    await lane.evaluate("(() => { const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
    await lane.until("document.querySelector('#shelf-tab-todos').getAttribute('aria-expanded') === 'true'");
    await lane.until("(() => { document.querySelector('.shelf [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click(); return document.querySelector('.shelf .todo-row-button')?.offsetHeight > 0; })()");
    await lane.capture("U3515a", "project-peers");
    await lane.browser("focus", ".shelf .todo-row-button");
    await lane.browser("press", "o");
    await lane.until("!!document.querySelector('[role=menu][data-state=open]')");
    await lane.capture("U3515c", "owner-offers");
    await lane.browser("press", "Escape");
    await lane.until("!document.querySelector('[role=menu][data-state=open]') && document.activeElement.classList.contains('todo-row-button')");
    await lane.browser("press", "t");
    await lane.until("!!document.querySelector('[data-triage=on]')");
    await lane.browser("press", "w");
    await lane.until("!!document.querySelector('[role=menu][data-state=open]')");
    await lane.capture("U3515c", "home-offers");
    await lane.browser("press", "Escape");
    await lane.until("!document.querySelector('[role=menu][data-state=open]') && document.activeElement.classList.contains('todo-row-button')");
    await lane.browser("press", "Escape");
    await lane.until("!document.querySelector('[data-triage=on]')");
    await lane.browser("click", ".shelf .todo-row-button");
    await lane.capture("U3515c", "opened-drawer");
    await lane.until("!!document.querySelector('.todo-blocker-trigger')");
    await lane.browser("click", ".todo-blocker-trigger");
    await lane.until("!!document.querySelector('.todo-blocker-menu [role=combobox]')");
    await lane.capture("U3515c", "dense-blocker-offers");
    await lane.browser("press", "Escape");
    await lane.until("!document.querySelector('.todo-blocker-menu [role=combobox]')");
    await lane.evaluate("window.__fake.failNext(-32003, 'Could not add blocker: dependency changed. Choose another todo.')");
    await lane.browser("click", ".todo-blocker-trigger");
    await lane.until("!!document.querySelector('.todo-blocker-menu [role=option]')");
    await lane.browser("click", ".todo-blocker-menu [role=option]");
    await lane.until("document.body.textContent.includes('Could not add blocker: dependency changed.')");
    await lane.capture("U3515c", "dense-rejected-choice");
    await lane.browser("press", "Escape");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const only = nodes.find(node => node.kind === 'agent');
      app.handlers['rail.tree'] = () => [{ ...only, parent: null, order: 0, name: 'Only Agent with a long descriptive name for the target picker audit' }];
      app.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'rail.changed' });
      return true;
    })()`);
    await lane.until("document.querySelectorAll('.rail [data-id]').length === 1");
    await lane.capture("U3515b", "only-source");
    await lane.capture("U3515d", "only-source-guard");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const todos = await app.rpc('todo.list', null);
      for (const todo of todos.slice(1)) await app.rpc('todo.delete', { id: todo.id });
      return true;
    })()`);
    await lane.until("document.querySelectorAll('.shelf .todo-row-button').length === 1");
    await lane.browser("click", ".shelf .todo-row-button");
    await lane.until("document.querySelector('.todo-blocker-trigger')?.getAttribute('aria-disabled') === 'true'");
    await lane.capture("U3515b", "disabled-blocker");
    await lane.browser("hover", ".todo-blocker-trigger");
    await lane.capture("U3515b", "disabled-blocker-hover");
    await lane.browser("focus", ".todo-blocker-trigger");
    await lane.browser("press", "Enter");
    await lane.browser("press", "Space");
    expect(await lane.evaluate<boolean>("document.activeElement.matches('.todo-blocker-trigger') && !document.activeElement.disabled && !!document.activeElement.title && !document.querySelector('.todo-blocker-menu [role=combobox]')")).toBe(true);
    await lane.capture("U3515b", "disabled-blocker-focus");
    await lane.browser("press", "Escape");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const pads = await app.rpc('pad.list', null);
      app.handlers['pad.list'] = () => [{ ...pads[0], owner: { kind: 'user', id: 'you', parent: null } }];
      app.handlers['rail.tree'] = () => [];
      app.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'rail.changed' });
      app.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'pad.changed', data: { name: pads[0].name } });
      return true;
    })()`);
    await lane.browser("click", "#shelf-tab-pads");
    await lane.until("document.querySelector('.pad-assign')?.getAttribute('aria-disabled') === 'true'");
    await lane.browser("hover", ".shelf .pad-inset");
    await lane.capture("U3515d", "disabled-assignment");
    await lane.browser("hover", ".pad-assign");
    await lane.capture("U3515d", "disabled-assignment-hover");
    await lane.browser("focus", ".pad-assign");
    await lane.browser("press", "Enter");
    await lane.browser("press", "Space");
    expect(await lane.evaluate<boolean>("document.activeElement.matches('.pad-assign') && !document.activeElement.disabled && !!document.activeElement.title && !document.querySelector('[role=menu][data-state=open]')")).toBe(true);
    await lane.capture("U3515d", "disabled-assignment-focus");
  } finally { await lane.close(); }
}, 90_000);
