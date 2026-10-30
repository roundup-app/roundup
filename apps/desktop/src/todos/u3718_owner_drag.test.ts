import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLane } from "./laneBrowser";
import type { LaneBrowser } from "./laneBrowser";

type Point = { x: number; y: number };

const ROW = (id: number) => `.shelf [data-id="${id}"] .sortable-handle`;

const HEAD = `.shelf [data-shelf-group="me"] .shelf-group-head`;

const centre = (lane: LaneBrowser, selector: string) => lane.evaluate<Point>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);

const move = (lane: LaneBrowser, x: number, y: number) => lane.browser("mouse", "move", String(x), String(y));

/** Start the existing pointer drag without requiring empty drop targets. */
const lift = async (lane: LaneBrowser, id: number) => {
  const from = await centre(lane, ROW(id));

  await move(lane, from.x, from.y);
  await lane.browser("mouse", "down");
  await move(lane, from.x, from.y - 6);
  await lane.until("!!document.querySelector('[data-dnd-placeholder]')");

  return from;
};

/** The press that follows a release is lost while the Sortable still closes the last drag (its slot fades out and its source row returns), which a loaded runner stretches past the next press. */
const SETTLED = "!document.querySelector('[data-dnd-dragging], [data-dnd-placeholder], .sortable-source, [data-ending]') && document.querySelector('.shelf .todo-list').getAnimations({ subtree: true }).length === 0";

const seedDestination = async (lane: LaneBrowser) => {
  await lane.evaluate(`(async () => { await window.__fake.app.rpc('todo.create', {title:'destination', body:null, blockers:null, owner:{kind:'user',id:'you',parent:null}}); })()`);
  await lane.until(`!!document.querySelector('.shelf [data-shelf-group="me"]')`);
  await lane.resetCalls();
};

describe("u3718 a Todo dragged to another owner's group", () => {
  let lane: LaneBrowser;

  beforeAll(async () => { lane = await openLane(1512, "dark", "u3718"); }, 180_000);

  afterAll(async () => { await lane?.close(); });

  it("u3718_nonempty_owner_is_a_drop_target_while_dragging", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    const [one] = await lane.order();

    await seedDestination(lane);
    await lift(lane, one!);
    const to = await centre(lane, HEAD);

    await move(lane, to.x, to.y);
    await lane.until(`!!document.querySelector('[data-drop-target]')`);
    await lane.capture("shelf-owner", "drag-over-group");
    await lane.browser("mouse", "up");
    await lane.until(`document.querySelector('.shelf [data-id="${one}"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === 'me'`);

    expect((await lane.calls("todo.assign")).map(call => call.params)).toEqual([{ id: one, owner: { kind: "user", id: "you", parent: null } }]);
    expect(await lane.calls("todo.reorder")).toEqual([]);
  }, 120_000);

  it("u4710c_u3718_a_rail_drop_moves_home_and_keeps_the_owner", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    const [one] = await lane.order();
    const owner = await lane.evaluate(`window.__fake.app.rpc('todo.list', null).then(todos => todos.find(todo => todo.id === ${one}).owner)`);
    const destination = await lane.evaluate<string>(`document.querySelector('[data-part="branch"][aria-expanded] > .rail-row').dataset.id`);
    const from = await lift(lane, one!);
    const to = await centre(lane, `[data-part="branch"][aria-expanded] > .rail-row`);

    await move(lane, from.x, from.y - 40);
    await move(lane, to.x, to.y);
    await lane.browser("mouse", "up");
    await lane.until(`window.__fake.app.calls.some(call => call.method === 'todo.move')`);

    expect(await lane.calls("todo.move")).toEqual([{method:"todo.move",params:{id:one,home:destination}}]);
    expect(await lane.evaluate(`window.__fake.app.rpc('todo.list', null).then(todos => todos.find(todo => todo.id === ${one}).owner)`)).toEqual(owner);
    expect(await lane.calls("todo.assign")).toEqual([]);
    expect(await lane.calls("todo.setBlockers")).toEqual([]);
    expect(await lane.calls("todo.reorder")).toEqual([]);
  }, 120_000);

  it("u3718_the_row_moves_only_after_the_refetch", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    const [one] = await lane.order();

    await seedDestination(lane);
    await lane.evaluate(`(() => { const app = window.__fake.app; const real = app.handlers["todo.list"]; window.__gate = new Promise(open => { window.__open = open; }); app.handlers["todo.list"] = async (params) => { await window.__gate; return real(params); }; return true; })()`);
    await lift(lane, one!);
    const to = await centre(lane, HEAD);

    await move(lane, to.x, to.y);
    await lane.browser("mouse", "up");
    await lane.until(`window.__fake.app.calls.some(call => call.method === 'todo.assign')`);

    expect(await lane.evaluate<string>(`document.querySelector('.shelf [data-id="${one}"]').closest('[data-shelf-group]').dataset.shelfGroup`)).toBe("unassigned");
    await lane.evaluate(`(() => { window.__open(); return true; })()`);
    await lane.until(`document.querySelector('.shelf [data-id="${one}"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === 'me'`);
  }, 120_000);

  it("u3720_esc_and_click_outside_close_and_restore_focus", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    const [one] = await lane.order();

    for (const close of [() => lane.browser("press", "Escape"), () => lane.browser("mouse", "move", "2", "2").then(() => lane.browser("mouse", "down")).then(() => lane.browser("mouse", "up"))]) {
      await lane.evaluate(`(() => { document.querySelector('.shelf [data-id="${one}"] .shelf-title').closest('button').focus(); return true; })()`);
      await lane.browser("press", "o");
      await lane.until(`!!document.querySelector('[role=menu]')`);
      await close();
      await lane.until(`!document.querySelector('[role=menu]')`);
      await lane.until(`document.activeElement.closest('[data-id="${one}"]') !== null`);
    }

    await lane.browser("click", ".shelf-add");
    await lane.until(`document.activeElement.matches('input, textarea')`);
    await lane.capture("shelf-owner", "new-todo-field");
    await lane.browser("press", "Escape");
  }, 120_000);
});

it("u3515c_todo_nesting_excludes_self_descendants_and_unchanged_placement", async () => {
  const lane = await openLane(1512, "dark", "u3515-nesting");

  try {
    await lane.seedTodos(["parent", "child", "grandchild", "sibling"], false);
    const [parent, child, grandchild, sibling] = await lane.order();
    await lane.evaluate(`(async () => {
      await window.__fake.app.rpc('todo.setBlockers', { id: ${child}, blockers: [${parent}] });
      await window.__fake.app.rpc('todo.setBlockers', { id: ${grandchild}, blockers: [${child}] });
      return true;
    })()`);
    await lane.until(`document.querySelector('.shelf [data-id="${grandchild}"]').closest('[role=treeitem]').getAttribute('aria-level') === '3'`);
    await lane.until(SETTLED);
    await lane.resetCalls();

    for (const target of [parent!, child!, grandchild!]) {
      const from = await centre(lane, ROW(parent!));
      const to = await centre(lane, ROW(target));
      const right = await lane.evaluate<number>("document.querySelector('.shelf .todo-list').getBoundingClientRect().right - 24");
      await move(lane, from.x, from.y);
      await lane.browser("mouse", "down");
      await move(lane, from.x + 6, from.y);
      await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
      await move(lane, Math.min(from.x + 100, right), to.y);
      await lane.browser("mouse", "up");
      await lane.until(SETTLED);
      expect((await lane.calls()).filter(call => ["todo.setBlockers", "todo.reorder", "todo.assign"].includes(call.method))).toEqual([]);
    }

    const from = await centre(lane, ROW(sibling!));
    const to = await centre(lane, ROW(parent!));
    await move(lane, from.x, from.y);
    // Ark unmounts the previous grip's closing Tooltip positioner after its exit.
    // Wait until that transient layer no longer takes the next pointer press.
    await lane.until(`document.elementFromPoint(${from.x}, ${from.y})?.closest('.sortable-handle') === document.querySelector(${JSON.stringify(ROW(sibling!))})`);
    await lane.browser("mouse", "down");
    await move(lane, from.x, from.y - 6);
    await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
    await move(lane, from.x, to.y - 4);
    await lane.browser("mouse", "up");
    await lane.until(SETTLED);
    expect((await lane.calls()).filter(call => ["todo.setBlockers", "todo.reorder", "todo.assign"].includes(call.method))).toEqual([
      { method: "todo.reorder", params: { id: sibling, before: parent } },
    ]);
  } finally { await lane.close(); }
}, 90_000);
