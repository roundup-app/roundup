import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { useShelfScope } from "./shelfScope";
import { node, workstream } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rail = this.matches('.rail, .rail-row, .todo-project-root');
    const root = this.matches('[data-todo-root]');
    const top = root || this.matches(".rail") ? 0 : this.dataset.id === "a" ? 80 : rail ? 40 : 0;

    return { x: rail ? 0 : 600, y: top, left: rail ? 0 : 600, right: rail ? 200 : 900, top, bottom: this.matches(".rail") ? 300 : rail ? top + 35 : 300, width: rail ? 200 : 300, height: rail ? 35 : 300, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(28);
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("todo-row") ? [...this.parentElement!.children].indexOf(this) * 30 : 0;
  });
});

const pointer = (target: Element | Window, type: string, x: number, y: number) => fireEvent(target, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));

const mount = async (home: string | null = null) => {
  const result = await mountTodos([todo(1, { home })], true, [workstream('r1', { name: 'alpha' }), node("a")], true);
  await screen.findByRole('button', { name: 'Idle #1 todo 1' });

  return result;
};

const start = () => {
  const row = screen.getByRole('button', { name: 'Idle #1 todo 1' });
  row.focus();
  pointer(row, 'pointerdown', 650, 50);
  pointer(window, 'pointermove', 100, 50);
};

it('u362_a_drop_on_a_workstream_calls_todo_move', async () => {
  const mounted = await mount();
  start();
  pointer(window, 'pointerup', 100, 50);
  await waitFor(() => expect(todoCallsTo(mounted.app, 'todo.move')).toEqual([{method: 'todo.move', params: {id: 1, home: 'r1'}}]));
  expect(todoCallsTo(mounted.app, 'todo.reorder')).toEqual([]);
  expect(todoCallsTo(mounted.app, 'todo.get')).toEqual([]);
  expect(screen.getByRole('button', { name: 'Idle #1 todo 1' })).toBeTruthy();
});

it('u362_a_drop_on_the_project_root_sends_null', async () => {
  const mounted = await mount('r1');
  start();
  pointer(window, 'pointermove', 100, 15);
  pointer(window, 'pointerup', 100, 15);
  await waitFor(() => expect(todoCallsTo(mounted.app, 'todo.move')).toEqual([{method: 'todo.move', params: {id: 1, home: null}}]));
});

it('u362_only_other_homes_are_targets', async () => {
  const mounted = await mount('r1');
  start();
  expect(document.querySelector('[data-todo-drop]')).toBeNull();
  pointer(window, 'pointerup', 100, 50);
  expect(todoCallsTo(mounted.app, 'todo.move')).toEqual([]);
});

it.each(['outside', 'escape'])('u362_a_drop_elsewhere_or_escape_calls_nothing %s', async (kind) => {
  const mounted = await mount();
  start();

  if (kind === 'escape') fireEvent.keyDown(window, {key: 'Escape'});
  pointer(window, 'pointerup', 400, 400);
  expect(todoCallsTo(mounted.app, 'todo.move')).toEqual([]);
  expect(todoCallsTo(mounted.app, 'todo.reorder')).toEqual([]);
  expect(document.querySelector('[data-todo-drop]')).toBeNull();
});

it('u362_focus_after_a_drop_is_never_body', async () => {
  const mounted = await mount();
  mounted.connected.rail.select('r1');
  useShelfScope(mounted.connected).setShowAll(false);
  // Show the Todo in its selected Home, then move it to the root.
  mounted.store.todos = [todo(1, {home: 'r1'})];
  mounted.app.emit(todoEvent('todo.updated', mounted.store.todos[0]!));
  await screen.findByRole('button', {name: 'Idle #1 todo 1'});
  mounted.app.handlers['todo.move'] = ({id, home}) => {
    const moved = todo(id, {home});
    mounted.store.todos = [moved];
    mounted.app.emit(todoEvent('todo.updated', moved));

    return moved;
  };

  start();
  pointer(window, 'pointerup', 100, 15);
  await waitFor(() => expect(todoCallsTo(mounted.app, 'todo.move')).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Idle #1 todo 1'})).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Project root'}));
});

it('u362_a_failed_move_shows_the_message', async () => {
  const mounted = await mount();
  mounted.app.handlers['todo.move'] = () => { throw new RpcError(-32000, 'cannot move'); };

  start();
  pointer(window, 'pointerup', 100, 50);
  await screen.findByText('cannot move');
  expect(screen.getByRole('button', {name: 'Idle #1 todo 1'})).toBe(document.activeElement);
  expect(document.querySelector('.todo-row')?.getAttribute('style') ?? '').not.toContain('translate');
});

it('u362_the_highlight_holds_the_place_and_clears_outside_the_rail', async () => {
  await mount();
  start();
  expect(document.querySelector('[data-todo-drop]')?.getAttribute('data-id')).toBe('r1');
  expect(document.querySelector('.todo-row')?.getAttribute('style') ?? '').not.toContain('translate');
  pointer(window, 'pointermove', 400, 400);
  expect(document.querySelector('[data-todo-drop]')).toBeNull();
  pointer(window, 'pointerup', 400, 400);
});

it('u362_a_drop_on_an_agent_calls_nothing', async () => {
  const mounted = await mount();
  start();
  pointer(window, 'pointermove', 100, 90);
  expect(document.querySelector('[data-todo-drop]')).toBeNull();
  pointer(window, 'pointerup', 100, 90);
  expect(todoCallsTo(mounted.app, 'todo.move')).toEqual([]);
});

it('u362_a_drag_inside_the_shelf_still_reorders', async () => {
  const mounted = await mountTodos([todo(1), todo(2), todo(3)], true, [workstream('r1')], true);
  const row = await screen.findByRole('button', {name: 'Idle #3 todo 3'});
  pointer(row, 'pointerdown', 650, 70);
  pointer(window, 'pointermove', 650, 5);
  pointer(window, 'pointerup', 650, 5);
  await waitFor(() => expect(todoCallsTo(mounted.app, 'todo.reorder')).toEqual([{method: 'todo.reorder', params: {id: 3, before: 1}}]));
  expect(todoCallsTo(mounted.app, 'todo.move')).toEqual([]);
});

it('u362_a_delayed_refetch_focuses_the_rail_when_the_row_leaves', async () => {
  const mounted = await mount('r1');
  mounted.connected.rail.select('r1');
  useShelfScope(mounted.connected).setShowAll(false);
  start();
  pointer(window, 'pointerup', 100, 15);
  await waitFor(() => expect(todoCallsTo(mounted.app, 'todo.move')).toHaveLength(1));
  expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Idle #1 todo 1'}));
  mounted.app.emit(todoEvent('todo.updated', mounted.store.todos[0]!));
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Idle #1 todo 1'})).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Project root'}));
});

it('u362_project_root_selection_follows_the_rail_selection', async () => {
  const mounted = await mount();
  const root = screen.getByRole('button', {name: 'Project root'});
  mounted.connected.rail.select(null);
  expect(root.getAttribute('aria-pressed')).toBe('true');
  mounted.connected.rail.select('r1');
  expect(root.getAttribute('aria-pressed')).toBe('false');
  mounted.connected.rail.select(null);
  expect(root.getAttribute('aria-pressed')).toBe('true');
});
