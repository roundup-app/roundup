import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { node, workstream, event, USER } from "../testing/nodes";
import { todoHandlers, padHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Shelf, ProjectShelfTabs, createShelfTabs } from "./Shelf";
import { createShelfFrame } from "./frame";
import { Tabs } from "../ui/Tabs";

afterEach(cleanup);

const mount = async () => {
  const app = createFakeApp();
  const tree = [workstream("w"), node("a", { parent: "w" }), workstream("v", { order: 1 }), node("b", { parent: "v" }), node("r", { order: 2 })];
  const store = { todos: [todo(1, { home: "w" }), todo(2, { home: "w", creator: { kind: "agent", id: "a", parent: "w" } }), todo(3, { home: "v" }), todo(4)] };
  const pads = { pads: store.todos.map(t => ({ name: `pad-${t.id}`, owner: t.creator, home: t.home, text: "", revision: 1, updated_at: 0 })), history: [] };
  app.handlers["rail.tree"] = () => tree;
  Object.assign(app.handlers, todoHandlers(store, data => app.emit(event(data))), padHandlers(pads, data => app.emit(event(data))));
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  await connected.rail.settled();
  render(() => {
    const frame = createShelfFrame(() => null, () => true, () => {});
    const tabs = createShelfTabs(frame);
    return <ConnectedProjectContext.Provider value={connected}><Tabs.RootProvider value={tabs}><ProjectShelfTabs frame={frame} onToggle={() => {}} /><Shelf open={() => true} /></Tabs.RootProvider></ConnectedProjectContext.Provider>;
  });
  return { app, connected, store, pads, tree };
};

const ids = () => [...document.querySelectorAll('[data-todo]')].map(el => Number(el.getAttribute('data-todo')));

it("u2744a_shelf_scope_workstream_lists_its_home", async () => {
  const { connected } = await mount();
  connected.rail.select("w");
  await waitFor(() => expect(ids()).toEqual([1, 2]));
  expect(screen.queryByRole("button", { name: /Show all Workstreams/ })).toBeNull();
});

it("u2744a_shelf_scope_agent_lists_only_its_own", async () => {
  const { connected } = await mount();
  connected.rail.select("a");
  await waitFor(() => expect(ids()).toEqual([2]));
});
