import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { node, workstream, event, info, USER } from "../testing/nodes";
import { todoHandlers, padHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Shelf, ProjectShelfTabs, createShelfTabs } from "../shelf/Shelf";
import { createShelfFrame } from "../shelf/frame";
import { Switcher } from "../switcher/Switcher";
import { leaderKey } from "../keys/leaderFixture";
import { Tabs } from "../ui/Tabs";

afterEach(cleanup);

const by = (id: string) => ({ kind: "agent" as const, id, parent: null });

const mount = async () => {
  const app = createFakeApp();
  const tree = [workstream("w"), node("a", { parent: "w" }), workstream("v", { order: 1 }), node("b", { parent: "v" }), node("r", { order: 2 })];

  const store = { todos: [
    todo(1, { home: "w", owner: USER }), todo(2, { home: "w", creator: by("a"), owner: by("a") }), todo(3, { home: "v", owner: by("b") }), todo(4),
    todo(5, { creator: by("a"), owner: by("a") }), todo(6, { creator: by("b"), home: "w" }), todo(7, { creator: by("r") }),
    todo(8, { creator: by("gone"), home: "w" }), todo(9, { creator: by("gone") }),
    todo(10, { creator: { kind: "ext", id: "ext", parent: null } }),
    todo(11, { creator: by("a"), home: "w", done: true }), todo(12, { creator: by("w"), home: "w" }),
  ] };

  const pads = { pads: store.todos.map(t => ({ incarnation: `fixture-${t.id}`, name: `pad-${t.id}`, owner: t.creator, home: t.home, text: "", revision: 1, updated_at: 0 })), history: [] };
  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => [info("shell-w", { owner: "w", title: "work shell" }), info("shell-root", { owner: "/p", title: "root shell" })];
  Object.assign(app.handlers, todoHandlers(store, data => app.emit(event(data))), padHandlers(pads, data => app.emit(event(data))));
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  await connected.rail.settled();
  render(() => {
    const frame = createShelfFrame(() => null, () => true, () => {});
    const tabs = createShelfTabs(frame);

    return <ConnectedProjectContext.Provider value={connected}><Tabs.RootProvider value={tabs}><ProjectShelfTabs frame={frame} onToggle={() => {}} /><Shelf open={() => true} /><Switcher onFailure={() => {}} onOpen={() => {}} /></Tabs.RootProvider></ConnectedProjectContext.Provider>;
  });

  return { app, connected, store, pads, tree };
};

const ids = () => [...document.querySelectorAll('.shelf-panel:not([hidden]) [data-todo]')].map(el => Number(el.getAttribute('data-todo')));

it("u2744a_shelf_scope_workstream_lists_its_home", async () => {
  const { connected } = await mount();
  connected.rail.select("w");
  await waitFor(() => expect(ids()).toEqual([1, 2, 6, 8, 12]));
  expect(screen.queryByRole("button", { name: /Show all Workstreams/ })).toBeNull();
});

it("u2744a_shelf_scope_agent_lists_only_its_own", async () => {
  const { connected } = await mount();
  connected.rail.select("a");
  await waitFor(() => expect(ids()).toEqual([2, 5]));
});

const tab = async (name: "Todos" | "Pads") => {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
  await waitFor(() => expect(document.querySelector(name === "Todos" ? "[data-shelf-scope] [aria-label^=\"add todo to\"]" : "[data-shelf-scope] [aria-label=\"Add Pad\"]")).not.toBeNull());
};

const names = () => [...document.querySelectorAll('.shelf-panel:not([hidden]) .pad-name')].map(el => el.textContent);

const disclosure = (id: string) => document.querySelector<HTMLElement>(`.shelf-panel:not([hidden]) [data-shelf-group="${id}"] [data-part="branch-control"]`)!;

const groupIds = () => [...document.querySelectorAll('.shelf-panel:not([hidden]) [data-shelf-group]')].map(el => el.getAttribute('data-shelf-group'));

const count = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) }).querySelector('.shelf-count')?.textContent ?? "0";

const ownTodos = (id: string) => [...document.querySelectorAll(`[data-shelf-group="${id}"] [data-todo]`)].flatMap(el => el.closest('[data-shelf-group]')?.getAttribute('data-shelf-group') === id ? [Number(el.getAttribute('data-todo'))] : []);

// The Todo placement clauses moved to U3717: u3717_todos_group_by_owner_once_each and u3717_group_order_is_me_agents_unassigned.
it("u2744a_shelf_scope_overview_groups_every_item_once", async () => {
  await mount();
  await waitFor(() => expect(ids()).toEqual([1, 2, 5, 3, 4, 6, 7, 8, 9, 10, 12]));
  await waitFor(() => expect(groupIds()).toEqual(["me", "a", "b", "unassigned"]));
  expect(ownTodos("me")).toEqual([1]);
  expect(ownTodos("a")).toEqual([2, 5]);
  expect(new Set(ids()).size).toBe(ids().length);
  await tab("Pads");
  await waitFor(() => expect(names()).toEqual(["pad-1", "pad-3", "pad-4", "pad-2", "pad-5", "pad-11", "pad-6", "pad-7", "pad-8", "pad-9", "pad-10", "pad-12"]));
  await waitFor(() => expect(groupIds()).toEqual(["me", "a", "b", "r", "unassigned"]));
});

// The Todo folding clause is proved by u3717_unassigned_starts_folded; this keeps the shared disclosure keys.
it("u2744a_shelf_scope_unassigned_starts_folded", async () => {
  const { connected } = await mount();
  await waitFor(() => expect(disclosure("unassigned")).toBeTruthy());
  expect(document.querySelector('[data-todo="4"]')?.closest("[hidden]")).toBeTruthy();
  const control = disclosure("unassigned");
  fireEvent.click(control);
  await waitFor(() => expect(document.querySelector('[data-todo="4"]')?.closest("[hidden]")).toBeNull());
  control.focus();

  for (const [key, visible] of [["ArrowLeft", false], ["ArrowRight", true], ["Enter", false], [" ", true]] as const) {
    fireEvent.keyDown(control, { key });
    await waitFor(() => expect(document.querySelector('[data-todo="4"]')?.closest("[hidden]") === null).toBe(visible));
    expect(document.activeElement).toBe(control);
    expect(connected.rail.selected()).toBeNull();
  }

  expect(screen.getByRole("button", { name: /#2 / })).toBeTruthy();
});

// The Todo scope clause moved to u3717_scope_still_selects_by_home_and_maker; this keeps the counts.
it("u2744a_shelf_scope_counts_follow_the_scope", async () => {
  const { connected } = await mount();
  await waitFor(() => expect([count("Todos"), count("Pads")]).toEqual(["11", "12"]));
  fireEvent.click(disclosure("me"));
  fireEvent.click(disclosure("unassigned"));
  expect([count("Todos"), count("Pads")]).toEqual(["11", "12"]);
  connected.rail.select("w");
  await waitFor(() => expect([count("Todos"), count("Pads")]).toEqual(["5", "6"]));
  expect(screen.getByRole("button", { name: /1 done/ })).toBeTruthy();
  connected.rail.select("a");
  await waitFor(() => expect([count("Todos"), count("Pads")]).toEqual(["2", "3"]));
});

it("u3717_scope_still_selects_by_home_and_maker", async () => {
  const { connected } = await mount();
  await waitFor(() => expect(groupIds()).toEqual(["me", "a", "b", "unassigned"]));
  connected.rail.select("w");
  await waitFor(() => expect(ids()).toEqual([1, 2, 6, 8, 12]));
  expect(groupIds()).toEqual(["me", "a", "unassigned"]);
  expect([ownTodos("me"), ownTodos("a"), ownTodos("unassigned")]).toEqual([[1], [2], [6, 8, 12]]);
  connected.rail.select("a");
  await waitFor(() => expect(ids()).toEqual([2, 5]));
  expect(groupIds()).toEqual(["a"]);
});

it("u2744a_shelf_scope_stopped_agent_items_show", async () => {
  const { connected, tree, app } = await mount();
  connected.rail.select("a");

  for (const kind of ["idle", "done"] as const) {
    tree[1] = { ...tree[1]!, terminal_id: null, status: { kind, label: kind, since: 0 } };
    app.emit(event({ name: "rail.changed" }));
    await connected.rail.settled();
    await waitFor(() => expect(ids()).toEqual([2, 5]));
    await tab("Pads");
    await waitFor(() => expect(names()).toEqual(["pad-2", "pad-5", "pad-11"]));
    await tab("Todos");
  }
});

it("u2744a_shelf_scope_moved_item_follows_its_home", async () => {
  const { connected, app } = await mount();
  await app.rpc("todo.move", { id: 2, home: "v" });
  await app.rpc("pad.move", { name: "pad-2", home: "v" });
  connected.rail.select("v");
  await waitFor(() => expect(ids()).toEqual([2, 3]));
  connected.rail.select("w");
  await waitFor(() => expect(ids()).toEqual([1, 6, 8, 12]));
  await tab("Pads");
  await waitFor(() => expect(names()).not.toContain("pad-2"));
  connected.rail.select("a");
  await waitFor(() => expect(names()).toContain("pad-2"));
  await tab("Todos");
  await waitFor(() => expect(ids()).toEqual([2, 5]));
});

// The Todo empty-group clause: u3717_group_order_is_me_agents_unassigned shows only groups holding a Todo.
it("u2744a_shelf_scope_empty_groups_are_omitted", async () => {
  const { connected, app } = await mount();
  connected.rail.select("v");
  await app.rpc("todo.delete", { id: 3 });
  await app.rpc("pad.delete", { name: "pad-3" });
  await waitFor(() => expect(groupIds()).toEqual([]));
  await tab("Pads");
  await waitFor(() => expect(groupIds()).toEqual([]));
  expect(screen.getByRole("button", { name: /Add Pad/ })).toBeTruthy();
});

it("u2744a_shelf_scope_events_refresh_membership", async () => {
  const { connected, tree, app } = await mount();
  connected.rail.select("a");
  await tab("Pads");
  await waitFor(() => expect(names()).toEqual(["pad-2", "pad-5", "pad-11"]));
  await app.rpc("pad.setOwner", { name: "pad-2", owner: USER });
  await waitFor(() => expect(names()).toEqual(["pad-5", "pad-11"]));
  connected.rail.select(null);
  tree.splice(1, 1);
  app.emit(event({ name: "rail.changed" }));
  await connected.rail.settled();
  await waitFor(() => expect(groupIds()).not.toContain("a"));
  expect(names().filter(name => name === "pad-5")).toHaveLength(1);
  await tab("Todos");
  await waitFor(() => expect(ownTodos("unassigned")).toEqual(expect.arrayContaining([2, 5])));
});

const chooseTerminal = async (title: string) => {
  leaderKey("KeyK");
  const field = await screen.findByRole("combobox");
  fireEvent.input(field, { target: { value: title } });
  await screen.findByRole("option", { name: new RegExp(title) });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
};

it.each([[null, null, null], ["w", "w", null], ["a", "w", null], ["r", null, null], [null, "w", "work shell"], [null, null, "root shell"]] as const)("u2744a_shelf_scope_add_uses_selected_workstream %s", async (selected, home, terminal) => {
  const { connected, app } = await mount();
  connected.rail.select(selected);

  if (terminal) await chooseTerminal(terminal);
  fireEvent.click(within(document.querySelector<HTMLElement>("[data-shelf-scope]")!).getByRole("button", { name: /add todo to/i }));
  const title = await screen.findByRole("textbox", { name: /New Todo title/ });
  fireEvent.input(title, { target: { value: "new scope item" } });
  fireEvent.keyDown(title, { key: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.create")).toHaveLength(1));
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.move").map(call => call.params)).toEqual(home ? [{ id: 13, home }] : []));
  expect((await app.rpc("todo.list", null)).find(todo => todo.id === 13)?.creator).toEqual(USER);
  await tab("Pads");
  fireEvent.click(screen.getByRole("button", { name: /Add Pad/ }));
  const name = await screen.findByRole("textbox", { name: /Pad name/ });
  fireEvent.input(name, { target: { value: "new-pad" } });
  fireEvent.keyDown(name, { key: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.create")).toHaveLength(1));
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.move").map(call => call.params)).toEqual(home ? [{ name: "new-pad", home }] : []));
  expect((await app.rpc("pad.list", null)).find(pad => pad.name === "new-pad")?.owner).toEqual(selected === "a" || selected === "r" ? by(selected) : USER);
});


it.each([["work shell", "w", [1, 2, 6, 8, 12], 6], ["root shell", null, [1, 2, 5, 3, 4, 6, 7, 8, 9, 10, 12], 12]] as const)("u2744a_shelf_scope_terminal_follows_its_owner %s", async (title, owner, expected, padCount) => {
  const { connected } = await mount();
  connected.rail.select("a");
  await chooseTerminal(title);
  await waitFor(() => expect(connected.rail.selected()).toBe(owner));
  await waitFor(() => expect(ids()).toEqual(expected));
  await tab("Pads");
  await waitFor(() => expect(names()).toHaveLength(padCount));
});

it("u2744a_shelf_scope_overview_groups_every_item_once_after_reorder", async () => {
  const { app } = await mount();
  const row = await screen.findByRole("button", { name: /#2 / });
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowDown", altKey: true });
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.reorder").map(call => call.params)).toEqual([{ id: 2, before: 6 }]));
  await waitFor(() => expect(ownTodos("a")).toEqual([5, 2]));
  expect(document.activeElement).toBe(row);
});

it("u458_grouped_ranges_follow_visible_order", async () => {
  await mount();
  const first = await screen.findByRole("button", { name: /#1 / });
  const second = await screen.findByRole("button", { name: /#2 / });
  const fifth = await screen.findByRole("button", { name: /#5 / });
  fireEvent.click(first, { metaKey: true });
  fireEvent.click(fifth, { shiftKey: true });
  expect([...document.querySelectorAll('[data-todo][data-selected=true]')].map(row => Number(row.getAttribute('data-todo')))).toEqual([1, 2, 5]);
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(second);
});

it("u2744a_shelf_scope_unassigned_starts_folded_when_first_added_after_folding", async () => {
  const { app, store, pads } = await mount();
  await waitFor(() => expect(groupIds()).toContain("unassigned"));
  store.todos = store.todos.filter(todo => ![4, 6, 7, 8, 9, 10, 12].includes(todo.id));
  pads.pads = pads.pads.filter(pad => !["pad-4", "pad-9", "pad-10"].includes(pad.name));
  app.emit(event({ name: "todo.deleted", data: { id: 4 } }));
  await waitFor(() => expect(groupIds()).not.toContain("unassigned"));
  fireEvent.click(disclosure("me"));
  await app.rpc("todo.create", { title: "unassigned arrives", body: null, blockers: null });
  await waitFor(() => expect(groupIds()).toContain("unassigned"));
  expect(disclosure("unassigned").closest('[role="treeitem"]')?.getAttribute("aria-expanded")).toBe("false");
});
