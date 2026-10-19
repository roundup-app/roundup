import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { node, workstream, event, info, USER } from "../testing/nodes";
import { todoHandlers, padHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Shelf, ProjectShelfTabs, createShelfTabs } from "./Shelf";
import { createShelfFrame } from "./frame";
import { Switcher } from "../switcher/Switcher";
import { leaderKey } from "../keys/leaderFixture";
import { Tabs } from "../ui/Tabs";

afterEach(cleanup);

const by = (id: string) => ({ kind: "agent" as const, id, parent: null });

const mount = async () => {
  const app = createFakeApp();
  const tree = [workstream("w"), node("a", { parent: "w" }), workstream("v", { order: 1 }), node("b", { parent: "v" }), node("r", { order: 2 })];

  const store = { todos: [
    todo(1, { home: "w" }), todo(2, { home: "w", creator: by("a") }), todo(3, { home: "v" }), todo(4),
    todo(5, { creator: by("a") }), todo(6, { creator: by("b"), home: "w" }), todo(7, { creator: by("r") }),
    todo(8, { creator: by("gone"), home: "w" }), todo(9, { creator: by("gone") }),
    todo(10, { creator: { kind: "ext", id: "ext", parent: null } }),
    todo(11, { creator: by("a"), home: "w", done: true }), todo(12, { creator: by("w"), home: "w" }),
  ] };

  const pads = { pads: store.todos.map(t => ({ name: `pad-${t.id}`, owner: t.creator, home: t.home, text: "", revision: 1, updated_at: 0 })), history: [] };
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
  await waitFor(() => expect(ids()).toEqual([1, 6, 8, 12, 2]));
  expect(screen.queryByRole("button", { name: /Show all Workstreams/ })).toBeNull();
});

it("u2744a_shelf_scope_agent_lists_only_its_own", async () => {
  const { connected } = await mount();
  connected.rail.select("a");
  await waitFor(() => expect(ids()).toEqual([2, 5]));
});

const tab = async (name: "Todos" | "Pads") => {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
  await screen.findByRole("button", { name: `Add ${name === "Todos" ? "Todo" : "Pad"}` });
};

const names = () => [...document.querySelectorAll('.shelf-panel:not([hidden]) .pad-name')].map(el => el.textContent);

const disclosure = (id: string) => document.querySelector<HTMLElement>(`.shelf-panel:not([hidden]) [data-shelf-group="${id}"] [data-part="branch-control"]`)!;

const groupIds = () => [...document.querySelectorAll('.shelf-panel:not([hidden]) [data-shelf-group]')].map(el => el.getAttribute('data-shelf-group'));

const count = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) }).querySelector('.shelf-count')?.textContent ?? "0";

const ownTodos = (id: string) => [...document.querySelectorAll(`[data-shelf-group="${id}"] [data-todo]`)].flatMap(el => el.closest('[data-shelf-group]')?.getAttribute('data-shelf-group') === id ? [Number(el.getAttribute('data-todo'))] : []);

it("u2744a_shelf_scope_overview_groups_every_item_once", async () => {
  await mount();
  await waitFor(() => expect(ids()).toEqual([1, 6, 8, 12, 2, 5, 3, 7, 4, 9, 10]));
  await waitFor(() => expect(groupIds()).toEqual(["w", "a", "v", "r", "unassigned"]));
  expect(ownTodos("w")).toEqual([1, 6, 8, 12]);
  expect(ownTodos("a")).toEqual([2, 5]);
  expect(new Set(ids()).size).toBe(ids().length);
  await tab("Pads");
  await waitFor(() => expect(names()).toEqual(["pad-1", "pad-6", "pad-8", "pad-12", "pad-2", "pad-5", "pad-11", "pad-3", "pad-7", "pad-4", "pad-9", "pad-10"]));
  await waitFor(() => expect(groupIds()).toEqual(["w", "a", "v", "r", "unassigned"]));
});

it("u2744a_shelf_scope_unassigned_starts_folded", async () => {
  const { connected } = await mount();
  await waitFor(() => expect(disclosure("unassigned")).toBeTruthy());
  expect(screen.queryByRole("button", { name: /#4 / })).toBeNull();
  const control = disclosure("unassigned");
  fireEvent.click(control);
  await screen.findByRole("button", { name: /#4 / });
  control.focus();

  for (const [key, visible] of [["ArrowLeft", false], ["ArrowRight", true], ["Enter", false], [" ", true]] as const) {
    fireEvent.keyDown(control, { key });
    await waitFor(() => expect(!!screen.queryByRole("button", { name: /#4 / })).toBe(visible));
    expect(document.activeElement).toBe(control);
    expect(connected.rail.selected()).toBeNull();
  }

  expect(screen.getByRole("button", { name: /#2 / })).toBeTruthy();
});

it("u2744a_shelf_scope_counts_follow_the_scope", async () => {
  const { connected } = await mount();
  await waitFor(() => expect([count("Todos"), count("Pads")]).toEqual(["11", "12"]));
  fireEvent.click(disclosure("w"));
  fireEvent.click(disclosure("unassigned"));
  expect([count("Todos"), count("Pads")]).toEqual(["11", "12"]);
  connected.rail.select("w");
  await waitFor(() => expect([count("Todos"), count("Pads")]).toEqual(["5", "6"]));
  expect(screen.getByRole("button", { name: /1 done/ })).toBeTruthy();
  connected.rail.select("a");
  await waitFor(() => expect([count("Todos"), count("Pads")]).toEqual(["2", "3"]));
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
  await waitFor(() => expect(ownTodos("v")).toEqual([2, 3]));
  expect(ownTodos("a")).toEqual([5]);
  connected.rail.select("w");
  await waitFor(() => expect(ids()).toEqual([1, 6, 8, 12]));
  await tab("Pads");
  await waitFor(() => expect(names()).not.toContain("pad-2"));
  connected.rail.select("a");
  await waitFor(() => expect(names()).toContain("pad-2"));
  await tab("Todos");
  await waitFor(() => expect(ids()).toEqual([2, 5]));
});

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

it("u2744a_shelf_scope_no_scope_button", async () => {
  const { connected, tree, app } = await mount();

  for (const selected of [null, "w", "a", "r"]) {
    connected.rail.select(selected);
    expect(document.querySelector('.scope-control')).toBeNull();
    expect(screen.queryByRole("button", { name: /Show (all|only)/ })).toBeNull();

    if (selected) expect(document.querySelector('[data-shelf-scope]')?.textContent).toBe(tree.find(node => node.id === selected)?.name);
  }

  tree[4] = { ...tree[4]!, name: "renamed root" };
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(document.querySelector('[data-shelf-scope]')?.textContent).toBe("renamed root"));
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
  await waitFor(() => expect(ownTodos("w")).toContain(2));
  expect(ownTodos("unassigned")).toContain(5);
});

it.each([[null, null], ["w", "w"], ["a", "w"], ["r", null]] as const)("u2744a_shelf_scope_add_uses_selected_workstream %s", async (selected, home) => {
  const { connected, app } = await mount();
  connected.rail.select(selected);
  fireEvent.click(screen.getByRole("button", { name: /Add Todo/ }));
  const title = await screen.findByRole("textbox", { name: /New Todo title/ });
  fireEvent.input(title, { target: { value: "new scope item" } });
  fireEvent.keyDown(title, { key: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.create")).toHaveLength(1));
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.move").map(call => call.params)).toEqual(home ? [{ id: 13, home }] : []));
  await tab("Pads");
  fireEvent.click(screen.getByRole("button", { name: /Add Pad/ }));
  const name = await screen.findByRole("textbox", { name: /Pad name/ });
  fireEvent.input(name, { target: { value: "new-pad" } });
  fireEvent.keyDown(name, { key: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.create")).toHaveLength(1));
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.move").map(call => call.params)).toEqual(home ? [{ name: "new-pad", home }] : []));
});


it.each([["work shell", "w", [1, 6, 8, 12, 2], 6], ["root shell", null, [1, 6, 8, 12, 2, 5, 3, 7, 4, 9, 10], 12]] as const)("u2744a_shelf_scope_terminal_follows_its_owner %s", async (title, owner, expected, padCount) => {
  const { connected } = await mount();
  connected.rail.select("a");
  leaderKey("KeyK");
  const field = await screen.findByRole("combobox");
  fireEvent.input(field, { target: { value: title } });
  await screen.findByRole("option", { name: new RegExp(title) });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
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
