import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, event } from "../testing/nodes";
import { withScopeRow } from "../testing/showEverything";
import { CHORDS, HELP_ROWS, hintsFor } from "../keys/chords";
import { copy } from "./copy";
import { mountTodos, todo, todoEvent, todoCallsTo as callsTo } from "./testHarness";

afterEach(cleanup);

const by = (id: string) => ({ kind: "agent" as const, id, parent: null });

const ME = { kind: "user" as const, id: "you", parent: null };

const groups = () => [...document.querySelectorAll("[data-shelf-group]")].map((el) => el.getAttribute("data-shelf-group"));

const unfold = (id: string) => fireEvent.click(document.querySelector(`[data-shelf-group="${id}"] [data-part="branch-control"]`)!);

const mount = (extra: Parameters<typeof todo>[1][] = []) => mountTodos([
  todo(1, { owner: ME }), todo(2, { owner: by("b") }), todo(3, { owner: by("a") }), todo(4), todo(5, { owner: by("gone") }), todo(6, { owner: by("a"), done: true }), ...extra.map((over, at) => todo(10 + at, over)),
], true, [agent("a", "idle", "A", { name: "alpha" }), agent("b", "idle", "B", { name: "beta", order: 1 })]);

it("u3717_todos_group_by_owner_once_each", async () => {
  await mount();
  await waitFor(() => expect(groups()).toEqual(["me", "a", "b", "unassigned"]));

  const own = (id: string) => [...document.querySelectorAll(`[data-shelf-group="${id}"] [data-todo]`)].map((el) => Number(el.getAttribute("data-todo")));

  expect([own("me"), own("a"), own("b"), own("unassigned")]).toEqual([[1], [3], [2], [4, 5]]);
});









// Choosing and focus are proved by u3720_choosing_assigns_once_and_returns_focus_to_the_row.
it("u3720_o_opens_the_owner_list_without_the_current_owner", async () => {
  await mount();
  await waitFor(() => expect(groups()).toContain("a"));
  const row = await screen.findByRole("button", { name: "Idle #3 todo 3" });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });
  const list = await screen.findByRole("menu", { name: "Owners for #3" });

  expect(within(list).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Me", "beta", "New Workstream…", "Unassigned"]);
});

it("u3720_o_is_inert_in_text_fields_with_modifiers_and_on_done_rows", async () => {
  await mount();
  await waitFor(() => expect(groups()).toContain("a"));
  const row = await screen.findByRole("button", { name: "Idle #3 todo 3" });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO", altKey: true });
  fireEvent.keyDown(row, { key: "o", code: "KeyO", ctrlKey: true });
  fireEvent.keyDown(row, { key: "O", code: "KeyO", shiftKey: true });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add Todo: Overview" }));
  fireEvent.keyDown(await screen.findByRole("textbox", { name: "New Todo title" }), { key: "o", code: "KeyO" });
  expect(screen.queryByRole("menu")).toBeNull();
});



it("u3720_a_failed_assign_shows_its_cause_and_keeps_the_group", async () => {
  const { app } = await mount();

  app.handlers["todo.assign"] = () => { throw new RpcError(-32004, "no such owner"); };

  await waitFor(() => expect(groups()).toContain("a"));
  fireEvent.contextMenu(document.querySelector('[data-todo="3"]')!);
  await app.pickMenu("Assign");
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));

  expect(await screen.findByText(/no such owner/)).toBeTruthy();
  expect(document.querySelector('[data-shelf-group="a"] [data-todo="3"]')).toBeTruthy();
});

const content = (id: string) => document.querySelector(`[data-shelf-group="${id}"] [data-part="branch-content"]`)!;

it("u3717_group_order_is_me_agents_unassigned", async () => {
  await mountTodos([todo(1, { owner: by("b") }), todo(2, { owner: by("a") }), todo(3, { owner: ME }), todo(4)], true, [agent("a", "idle", "A", { name: "alpha", order: 1 }), agent("b", "idle", "B", { name: "beta", order: 0 })]);

  await waitFor(() => expect(groups()).toEqual(["me", "b", "a", "unassigned"]));
});

it("u3789b_return_files_once_without_unfolding_new_destination", async () => {
  const { app, store } = await mountTodos([todo(1, { owner: ME })]);
  await waitFor(() => expect(groups()).toEqual(["me"]));

  store.todos = [...store.todos, todo(4)];
  app.emit(todoEvent("todo.created", store.todos[1]!));

  await waitFor(() => expect(groups()).toEqual(["me", "unassigned"]));
  expect(content("unassigned").hasAttribute("hidden")).toBe(false);
  expect(content("me").hasAttribute("hidden")).toBe(false);
});

it("u3717_owner_event_regroups_the_row", async () => {
  const { app, store } = await mount();
  await waitFor(() => expect(groups()).toContain("b"));

  store.todos = store.todos.map((each) => each.id === 4 ? { ...each, owner: by("b") } : each);
  app.emit(todoEvent("todo.updated", store.todos.find((each) => each.id === 4)!));

  await waitFor(() => expect(document.querySelector('[data-shelf-group="b"] [data-todo="4"]')).toBeTruthy());
  expect(document.querySelector('[data-shelf-group="unassigned"] [data-todo="4"]')).toBeNull();
});





// Esc and outside dismissal are proved by u3720_esc_and_click_outside_close_and_restore_focus.
it("u3720_choosing_assigns_once_and_returns_focus_to_the_row", async () => {
  const { app } = await mount();
  await waitFor(() => expect(groups()).toContain("a"));
  fireEvent.contextMenu(document.querySelector('[data-todo="3"]')!);
  await app.pickMenu("Assign");
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Unassigned"));

  await waitFor(() => expect(callsTo(app, "todo.assign").map(call => call.params)).toEqual([{ id: 3, owner: null }]));
  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe("3"));
  expect(document.activeElement).not.toBe(document.body);
});

it("u3720_the_key_is_a_registered_shelf_binding_listed_in_help", () => {
  const owned = CHORDS.filter((chord) => chord.presses.includes("KeyO"));

  expect(owned).toHaveLength(1);
  expect(owned[0]).toMatchObject({ inShelf: true, keys: "O" });
  expect(HELP_ROWS).toContainEqual(expect.objectContaining({ keys: "O", what: copy.assignTodo }));
  expect(hintsFor("shelf").map((hint) => hint.keys)).toContain("O");
});



it("u3720_assigning_into_a_folded_group_unfolds_it_and_focuses_the_row", async () => {
  const { app } = await mount();
  await waitFor(() => expect(groups()).toContain("unassigned"));
  unfold("unassigned");
  await waitFor(() => expect(content("unassigned").hasAttribute("hidden")).toBe(true));
  fireEvent.contextMenu(document.querySelector('[data-todo="1"]')!);
  await app.pickMenu("Assign");
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Unassigned"));

  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe("1"));
  expect(content("unassigned").hasAttribute("hidden")).toBe(false);
});
