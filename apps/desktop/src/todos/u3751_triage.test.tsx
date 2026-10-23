import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { CHORDS } from "../keys/chords";
import { agent, workstream } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const by = (id: string) => ({ kind: "agent" as const, id, parent: null });

const RAIL = [workstream("w", { name: "work" }), agent("a", "idle", "A", { name: "alpha", parent: "w" })];

const mount = () => mountTodos([todo(1, { owner: by("a") }), todo(2), todo(3), todo(4, { done: true })], true, RAIL);

const row = (id: number) => document.querySelector<HTMLButtonElement>(`[data-todo="${id}"] .row-head .todo-row-button`)!;

const shelf = () => document.querySelector(".shelf")!;

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
  target.focus();

  return fireEvent.keyDown(target, { key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, ...init });
};

const enter = async () => {
  const mounted = await mount();

  await waitFor(() => expect(row(2)?.closest("[hidden]")).toBeNull());
  press(row(2), "t");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));

  return mounted;
};

it("u3751_t_enters_the_mode_and_keeps_focus_and_data", async () => {
  const { app, store } = await mount();
  await waitFor(() => expect(row(2)?.closest("[hidden]")).toBeNull());
  const before = JSON.stringify(store.todos);

  expect(shelf().getAttribute("data-triage")).toBe("off");
  press(row(2), "t");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));
  expect(document.activeElement).toBe(row(2));
  expect(app.calls.filter(call => call.method.startsWith("todo.") && call.method !== "todo.list")).toEqual([]);
  expect(JSON.stringify(store.todos)).toBe(before);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();

  press(row(2), "Escape");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("off"));
  const head = screen.getByRole("button", { name: "Triage" });

  head.focus();
  fireEvent.click(head);
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));
  expect(document.activeElement).toBe(row(1));
});

it("u3751_esc_returns_focus_to_the_entry_row_or_the_nearest", async () => {
  const { app, store } = await enter();

  press(row(2), "j");
  expect(document.activeElement).toBe(row(3));
  press(row(3), "Escape");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("off"));
  expect(document.activeElement).toBe(row(2));
  expect(app.calls.filter(call => call.method !== "todo.list" && call.method.startsWith("todo."))).toEqual([]);

  press(row(2), "t");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));
  store.todos = store.todos.map(item => item.id === 2 ? { ...item, done: true } : item);
  app.emit(todoEvent("todo.updated", store.todos[1]!));
  await waitFor(() => expect(document.querySelector('[data-todo="2"] .row-head')).toBeNull());
  press(row(3), "Escape");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("off"));
  expect([row(1), row(3)]).toContain(document.activeElement);
});

it("u3751_t_is_ignored_in_fields_and_with_modifiers", async () => {
  await mount();
  await waitFor(() => expect(row(2)?.closest("[hidden]")).toBeNull());

  for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) press(row(2), "t", init);
  fireEvent.click(screen.getAllByRole("button", { name: /add todo to/ })[0]!);
  press(await screen.findByRole("textbox", { name: "New Todo title" }), "t");
  expect(shelf().getAttribute("data-triage")).toBe("off");
});

it("u3752_the_hint_line_is_the_registry_rows_and_leaves_with_the_mode", async () => {
  await enter();
  const line = document.querySelector<HTMLElement>(".triage-hints")!;
  const rows = CHORDS.filter(chord => chord.inTriage);

  const squash = (text: string) => text.replace(/\s+/g, "");

  expect([...line.querySelectorAll(".hint")].map(hint => squash(hint.textContent!))).toEqual(rows.map(chord => squash(`${chord.keys}${chord.what}`)));
  press(row(2), "Escape");
  await waitFor(() => expect(document.querySelector(".triage-hints")).toBeNull());
});

it("u3753_j_and_k_move_focus_across_groups_and_call_nothing", async () => {
  const { app } = await enter();
  const order = [...document.querySelectorAll<HTMLElement>(".todos-tab [data-shelf-row][data-todo]")].flatMap(each => each.closest(".todo-done-fold") ? [] : [Number(each.dataset.todo)]);

  expect(order).toHaveLength(3);
  const first = order[0]!;
  const last = order.at(-1)!;

  press(row(last), "j");
  expect(document.activeElement).toBe(row(last));
  press(row(last), "k");
  expect(document.activeElement).toBe(row(order.at(-2)!));
  press(row(first), "k");
  expect(document.activeElement).toBe(row(first));
  press(row(first), "j");
  expect(document.activeElement).toBe(row(order[1]!));
  expect(app.calls.filter(call => call.method !== "todo.list" && call.method.startsWith("todo."))).toEqual([]);
});

it("u3753_a_and_w_call_assign_and_move_once_each", async () => {
  const { app } = await enter();

  press(row(2), "a");
  const owners = await screen.findByRole("menu", { name: "Owners for #2" });
  fireEvent.click(within(owners).getByRole("menuitem", { name: "alpha" }));
  await waitFor(() => expect(callsTo(app, "todo.assign").map(call => call.params)).toEqual([{ id: 2, owner: by("a") }]));
  await waitFor(() => expect(document.activeElement).toBe(row(3)));

  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  press(row(3), "w");
  const homes = await screen.findByRole("menu", { name: "Homes for #3" });
  expect(within(homes).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["work", "scope"]);
  fireEvent.click(within(homes).getByRole("menuitem", { name: "work" }));
  await waitFor(() => expect(callsTo(app, "todo.move").map(call => call.params)).toEqual([{ id: 3, home: "w" }]));
  expect(callsTo(app, "todo.assign")).toHaveLength(1);
});

it("u3753_x_completes_once_and_focus_moves_on", async () => {
  const { app, store } = await enter();

  press(row(2), "x");
  press(row(2), "x", { repeat: true });
  await waitFor(() => expect(callsTo(app, "todo.complete").map(call => call.params)).toEqual([{ id: 2 }]));
  app.emit(todoEvent("todo.updated", store.todos.find(item => item.id === 2)!));
  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe("3"));
  expect(callsTo(app, "todo.complete")).toHaveLength(1);
});

it("u3753_c_opens_the_comment_field_and_esc_returns_to_the_row", async () => {
  const { app } = await enter();

  press(row(2), "c");
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "hello" } });
  fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row(2)));
  expect(document.querySelector(".drawer")?.getAttribute("data-open")).not.toBe("true");
  expect(shelf().getAttribute("data-triage")).toBe("on");
  expect(callsTo(app, "todo.comment")).toEqual([]);
});

it("u3753_the_keys_do_nothing_outside_the_mode", async () => {
  const { app } = await mount();
  await waitFor(() => expect(row(2)?.closest("[hidden]")).toBeNull());

  for (const key of ["j", "k", "a", "w", "x", "c"]) press(row(2), key);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(row(2));
  expect(callsTo(app, "todo.complete")).toEqual([]);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
});

it("u3754_a_refused_key_keeps_mode_focus_and_shows_the_cause", async () => {
  const { app } = await enter();

  app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32003, "already moved"));
  press(row(2), "x");
  await screen.findByText("already moved");
  expect(shelf().getAttribute("data-triage")).toBe("on");
  expect(document.activeElement).toBe(row(2));
  expect(document.querySelector('[data-todo="2"] [role="alert"]')?.textContent).toContain("already moved");
});

it("u3755_esc_in_the_comment_field_keeps_the_draft", async () => {
  const { app } = await enter();

  press(row(2), "c");
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "draft" } });
  fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row(2)));
  expect(document.querySelector(".drawer")?.getAttribute("data-open")).not.toBe("true");
  expect(shelf().getAttribute("data-triage")).toBe("on");
  expect(callsTo(app, "todo.comment")).toEqual([]);

  press(row(2), "c");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Write a comment" })));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" }).value).toBe("draft");
});

it.each(["body", "toggle", "control", "heading"])("u3474a_enters_and_leaves_from_each_todos_target: %s", async (target) => {
  await mount();
  const toggle = screen.getByRole("button", { name: "Triage" });
  const start = target === "body" ? document.body : target === "toggle" ? toggle : target === "heading" ? document.querySelector<HTMLElement>(".shelf-group-control")! : screen.getAllByRole("button", { name: /add todo to/ })[0]!;

  if (target === "body" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  else start.focus();
  fireEvent.keyDown(document.activeElement!, { key: "t", code: "KeyT" });
  await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
  expect(document.activeElement).toBe(row(1));
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

const nextKey = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body,
  { key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, ...init });

it.each(["x", "Tab", "un-nest", "a", "o", "w", "c", "j", "k"].flatMap(action => [false, true].map(last => ({ action, last }))))("u3474b_two_key_actions_keep_working: $action, last=$last", async ({ action, last }) => {
  const id = last ? 3 : 2;
  const { app, store } = await mountTodos([todo(0, { owner: by("a") }), ...[1, 2, 3].map(each => todo(each, { blockers: each === id && action === "un-nest" ? [id - 1] : [] }))], true, RAIL);
  await waitFor(() => expect(row(id)?.closest("[hidden]")).toBeNull());
  row(id).focus();
  nextKey("t");
  nextKey(action === "un-nest" ? "Tab" : action, { shiftKey: action === "un-nest" });

  if (action === "a" || action === "o" || action === "w") {
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    nextKey(action === "w" ? "w" : "a");
    await waitFor(() => expect(menu.getAttribute("aria-activedescendant")).toBe(within(menu).getByRole("menuitem", { name: action === "w" ? "work" : "alpha" }).id));
    nextKey("Enter");
  }

  if (action === "c") {
    const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.input(field, { target: { value: "reviewed" } });
    nextKey("Enter");
    await waitFor(() => expect(callsTo(app, "todo.comment").map(call => call.params)).toEqual([{ id, body: "reviewed" }]));
  }

  const destination = action === "k" ? id - 1 : last && action !== "j" ? 2 : 3;
  await waitFor(() => expect(document.activeElement).toBe(row(destination)));
  expect(shelf().getAttribute("data-triage")).toBe("on");

  if (action === "c") expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();

  if (action === "x") expect(store.todos.find(todo => todo.id === id)?.done).toBe(true);

  if (action === "Tab") expect(store.todos.find(todo => todo.id === id)?.blockers).toEqual([id - 1]);

  if (action === "un-nest") expect(store.todos.find(todo => todo.id === id)?.blockers).toEqual([]);

  if (action === "a" || action === "o") expect(store.todos.find(todo => todo.id === id)?.owner).toEqual(by("a"));

  if (action === "w") expect(store.todos.find(todo => todo.id === id)?.home).toBe("w");
  nextKey("x");
  await waitFor(() => expect(store.todos.find(todo => todo.id === destination)?.done).toBe(true));
  expect(callsTo(app, "todo.complete").map(call => call.params)).toEqual(action === "x" ? [{ id }, { id: destination }] : [{ id: destination }]);
});

it.each(["j", "k", "a", "o", "w", "Tab", "un-nest", "x", "c"])("u3474c_recovers_a_missing_or_empty_target: %s", async action => {
  const { app } = await enter();
  screen.getByRole("button", { name: "Triage" }).focus();
  const before = app.calls.length;
  nextKey(action === "un-nest" ? "Tab" : action, { shiftKey: action === "un-nest" });
  expect(document.activeElement).toBe(row(1));
  expect(app.calls.slice(before)).toEqual([]);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(shelf().getAttribute("data-triage")).toBe("on");
});

it("u3474c_recovers_a_missing_or_empty_target_after_arrival", async () => {
  const { app, store } = await mountTodos([]);
  screen.getByRole("button", { name: "Triage" }).focus();
  nextKey("t");

  for (const key of ["j", "k", "a", "o", "w", "Tab", "x", "c"]) nextKey(key);
  expect(callsTo(app, "todo.complete")).toEqual([]);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Triage" }));
  store.todos = [todo(1)];
  app.emit(todoEvent("todo.created", store.todos[0]!));
  await waitFor(() => expect(row(1)).toBeTruthy());
  const disclosure = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]')!;
  fireEvent.click(disclosure);
  await waitFor(() => expect(row(1)?.closest("[hidden]")).toBeNull());
  nextKey("x");
  expect(callsTo(app, "todo.complete")).toEqual([]);
  expect(document.activeElement).toBe(row(1));
  nextKey("x");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Triage" })));
  nextKey("Escape");
  expect(shelf().getAttribute("data-triage")).toBe("off");
});


it("u3474b_the_last_completed_row_returns_to_the_toggle_before_its_exit_finishes", async () => {
  const { store } = await mountTodos([todo(1)], false);
  const toggle = screen.getByRole("button", { name: "Triage" });
  await waitFor(() => expect(row(1)?.closest("[hidden]")).toBeNull());
  toggle.focus();
  nextKey("t");
  nextKey("x");
  await waitFor(() => expect(document.activeElement).toBe(toggle));
  expect(store.todos[0]?.done).toBe(true);
  nextKey("Escape");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

it("u3474b_done_keeps_the_regrouped_nested_row_ready", async () => {
  const { store } = await mountTodos([todo(1), todo(2), todo(3), todo(4, { blockers: [3, 5], blocked: true }), todo(5)], false);
  row(1).focus();
  nextKey("t");

  for (const [id, next] of [[1, 2], [2, 3], [3, 4], [4, 5]]) {
    nextKey("x");
    await waitFor(() => expect(store.todos.find(todo => todo.id === id)?.done).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(row(next!)));
  }
});
