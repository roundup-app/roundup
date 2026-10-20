import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

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

it("u3719_the_plus_creates_in_that_groups_owner", async () => {
  const { app } = await mount();
  await waitFor(() => expect(groups()).toContain("a"));

  for (const [group, label, params] of [["me", "Me", { owner: ME }], ["a", "alpha", { owner: by("a") }], ["unassigned", "Unassigned", {}]] as const) {
    fireEvent.click(screen.getByRole("button", { name: `add todo to ${label}` }));
    const field = await screen.findByRole("textbox", { name: "New Todo title" });

    expect(within(document.querySelector(`[data-shelf-group="${group}"]`)!).getByRole("textbox")).toBe(field);
    fireEvent.input(field, { target: { value: `into ${label}` } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(callsTo(app, "todo.create").at(-1)?.params).toEqual({ title: `into ${label}`, body: null, blockers: null, ...params }));
    fireEvent.keyDown(field, { key: "Escape" });
  }

  expect(callsTo(app, "todo.create")).toHaveLength(3);
});

it("u3719_the_plus_never_toggles_the_fold_and_opens_a_folded_group", async () => {
  await mount();
  await waitFor(() => expect(groups()).toContain("unassigned"));
  const content = () => document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-content"]')!;

  unfold("unassigned");
  await waitFor(() => expect(content().hasAttribute("hidden")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "add todo to Unassigned" }));
  const field = await screen.findByRole("textbox", { name: "New Todo title" });

  expect(content().hasAttribute("hidden")).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "add todo to Unassigned" })));
  expect(content().hasAttribute("hidden")).toBe(false);
});

it("u3719_a_failed_create_keeps_the_text_and_shows_its_cause", async () => {
  const { app } = await mount();

  app.handlers["todo.create"] = () => { throw new RpcError(-32004, "agent gone"); };

  await waitFor(() => expect(groups()).toContain("a"));
  fireEvent.click(screen.getByRole("button", { name: "add todo to alpha" }));
  const field = await screen.findByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "x" } });
  fireEvent.keyDown(field, { key: "Enter" });

  expect(await within(document.querySelector('[data-shelf-group="a"]')!).findByText(/agent gone/)).toBeTruthy();
});

it("u3720_o_opens_the_owner_list_without_the_current_owner_and_choosing_assigns_once", async () => {
  const { app } = await mount();
  await waitFor(() => expect(groups()).toContain("a"));
  const row = await screen.findByRole("button", { name: "Idle #3 todo 3" });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });
  const list = await screen.findByRole("menu", { name: "Owners for #3" });

  expect(within(list).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Me", "beta", "Unassigned"]);
  fireEvent.click(within(list).getByText("Me"));
  await waitFor(() => expect(callsTo(app, "todo.assign")).toHaveLength(1));
  expect(callsTo(app, "todo.assign")[0]?.params).toEqual({ id: 3, owner: ME });
  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe("3"));
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
  fireEvent.click(screen.getByRole("button", { name: "add todo to Me" }));
  fireEvent.keyDown(await screen.findByRole("textbox", { name: "New Todo title" }), { key: "o", code: "KeyO" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("u3720_the_assign_word_opens_the_same_list", async () => {
  await mount();
  await waitFor(() => expect(groups()).toContain("a"));
  fireEvent.click(await screen.findByRole("button", { name: "assign #3", hidden: true }));

  expect(await screen.findByRole("menu", { name: "Owners for #3" })).toBeTruthy();
});

it("u3720_a_failed_assign_shows_its_cause_and_keeps_the_group", async () => {
  const { app } = await mount();

  app.handlers["todo.assign"] = () => { throw new RpcError(-32004, "no such owner"); };

  await waitFor(() => expect(groups()).toContain("a"));
  fireEvent.click(await screen.findByRole("button", { name: "assign #3", hidden: true }));
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));

  expect(await screen.findByText(/no such owner/)).toBeTruthy();
  expect(document.querySelector('[data-shelf-group="a"] [data-todo="3"]')).toBeTruthy();
});
