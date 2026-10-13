import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rail = this.matches('.rail, .rail-row');
    const root = this.matches('[data-todo-root]');
    const top = root ? 0 : rail ? 40 : 0;
    return { x: rail ? 0 : 600, y: top, left: rail ? 0 : 600, right: rail ? 200 : 900, top, bottom: rail ? top + 35 : 300, width: rail ? 200 : 300, height: rail ? 35 : 300, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(28);
});

const pointer = (target: Element | Window, type: string, x: number, y: number) => fireEvent(target, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
const mount = async (home: string | null = null) => {
  const result = await mountTodos([todo(1, { home })], true, [workstream('r1', { name: 'alpha' })], true);
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
  expect(document.querySelector('[data-drop="hover"]')).toBeNull();
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
  expect(document.querySelector('[data-drop="hover"]')).toBeNull();
});

it('u362_focus_after_a_drop_is_never_body', async () => {
  const mounted = await mount();
  mounted.connected.rail.select('r1');
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
  expect(document.activeElement).not.toBe(document.body);
});
