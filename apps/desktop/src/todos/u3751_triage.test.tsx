import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { CHORDS, HELP_ROWS } from "../keys/chords";
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

  await waitFor(() => expect(row(2)).toBeTruthy());
  press(row(2), "t");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));

  return mounted;
};

it("u3751_t_enters_the_mode_and_keeps_focus_and_data", async () => {
  const { app, store } = await mount();
  await waitFor(() => expect(row(2)).toBeTruthy());
  const before = JSON.stringify(store.todos);

  expect(shelf().getAttribute("data-triage")).toBe("off");
  press(row(2), "t");
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));
  expect(document.activeElement).toBe(row(2));
  expect(app.calls.filter(call => call.method.startsWith("todo.") && call.method !== "todo.list")).toEqual([]);
  expect(JSON.stringify(store.todos)).toBe(before);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(CHORDS.filter(chord => chord.keys === "T" && chord.inShelf)).toHaveLength(1);
  expect(HELP_ROWS.filter(chord => chord.keys === "T")).toHaveLength(1);

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
  await waitFor(() => expect(row(2)).toBeTruthy());

  for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) press(row(2), "t", init);
  fireEvent.click(screen.getAllByRole("button", { name: /add todo to/ })[0]!);
  press(await screen.findByRole("textbox", { name: "New Todo title" }), "t");
  expect(shelf().getAttribute("data-triage")).toBe("off");
});

it("u3752_the_hint_line_is_the_registry_rows_and_leaves_with_the_mode", async () => {
  await enter();
  const line = document.querySelector<HTMLElement>(".triage-hints")!;
  const rows = CHORDS.filter(chord => chord.inTriage);

  expect(rows.map(chord => chord.keys)).toEqual(["J K", "A", "W", "Tab", "⇧Tab", "X", "C", "Esc"]);
  const squash = (text: string) => text.replace(/\s+/g, "");

  expect([...line.querySelectorAll(".hint")].map(hint => squash(hint.textContent!))).toEqual(rows.map(chord => squash(`${chord.keys}${chord.what}`)));
  expect(HELP_ROWS.filter(chord => rows.some(each => each.keys === chord.keys && each.what === chord.what))).toHaveLength(rows.length);
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
  await waitFor(() => expect(document.activeElement).toBe(row(2)));

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
  await waitFor(() => expect(row(2)).toBeTruthy());

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
