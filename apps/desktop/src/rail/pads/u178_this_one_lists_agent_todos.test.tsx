import { Show } from "solid-js";
import { ScopeControl } from "../../shelf/ScopeControl";
import { useShelfScope } from "../../todos/shelfScope";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../../drawer/DrawerHost";
import { Keys } from "../../keys/Keys";
import { Pads } from "../../pads/Pads";
import { ConnectedProjectContext, connectProject } from "../../state/connectedProject";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, event, NOW, workstream } from "../../testing/nodes";
import { padHandlers, todoHandlers } from "../../testing/stores";
import type { PadStore, TodoStore } from "../../testing/stores";
import { Todos } from "../../todos/Todos";
import { todo } from "../../todos/testHarness";
import { Rail } from "../Rail";
import { rowOf } from "../railFixture";

afterEach(cleanup);

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const padOf = (name: string, who: Actor): Pad => ({ name, owner: who, text: "", updated_at: 0, revision: 1, home: null });

const mount = async (tree: RailNode[], todos: Todo[], pads: Pad[] = []) => {
  const padState: PadStore = { pads, history: [] };
  const store: TodoStore = { todos };
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(tree);
  Object.assign(app.handlers, padHandlers(padState, (data) => app.emit(event(data))));
  Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
  await showEverything(connected);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Keys />
      <Rail />
      <Pads />
      <Show when={useShelfScope(connected).workstream()}><ScopeControl showAll={useShelfScope(connected).showAll()} onChange={useShelfScope(connected).setShowAll} /></Show>
      <Todos />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  return { app, store, connected };
};

const TREE = [
  workstream("w1", { name: "ship" }),
  workstream("w2", { name: "other", order: 1 }),
  agent("a1", "working", "x", { name: "auth", parent: "w1" }),
  agent("a2", "working", "x", { name: "docs", parent: "w1", order: 1 }),
  agent("a3", "working", "x", { name: "misc", parent: "w2" }),
];

const TODOS = [
  todo(1, { home: "w1" }),
  todo(2, { home: "w1", creator: by("a1") }),
  todo(3, { home: "w1", creator: by("a2") }),
  todo(4, { home: "w2", creator: by("a3") }),
  todo(5, { home: "w1", creator: by("a1"), done: true }),
];

const shelf = () => within(screen.getByRole("region", { name: "Todos" }));

const shelfIds = () => [...document.querySelectorAll("[data-shelf-row]")].map((row) => row.getAttribute("data-id"));

describe("u178 this one lists every open Todo of the Workstream", () => {
  it("u178_this_one_lists_the_users_and_both_agents_todos_in_order_and_not_another_workstreams", async () => {
    const { connected } = await mount(TREE, TODOS);

    await shelf().findByRole("button", { name: /#1 todo 1/ });
    connected.rail.select("w1");
    await screen.findByRole("button", { name: "Show all Workstreams" });

    await waitFor(() => expect(shelfIds()).toEqual(["1", "2", "3"]));
    expect(rowOf("auth")).toBeTruthy();
  });

  it("u178_all_still_moves_an_agents_todo_under_its_row", async () => {
    const { connected } = await mount(TREE, TODOS);

    await shelf().findByRole("button", { name: /#1 todo 1/ });
    connected.rail.select("w1");
    fireEvent.click(await screen.findByRole("button", { name: "Show all Workstreams" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Show only this Workstream" }).getAttribute("aria-pressed")).toBe("true"));
    expect(shelfIds()).toEqual(["1"]);
  });

  it("u178_the_control_is_named_by_what_it_holds", async () => {
    await mount(TREE, [todo(2, { home: "w1", creator: by("a1") }), todo(3, { home: "w1", creator: by("a2") })], [padOf("n", by("a1"))]);

    const named = async (row: string, name: string) => {
      const button = await waitFor(() => within(rowOf(row)).getByRole("button", { name }));

      fireEvent.keyDown(document, { key: "Tab" });
      button.focus();
      await waitFor(() => expect(screen.getAllByRole("tooltip").map((tip) => tip.textContent)).toContain(name));
      button.blur();
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    };

    await named("auth", "2 pads and todos");
    await named("docs", "1 todos");
  });

  it("u178_a_pads_only_control_is_named_pads", async () => {
    await mount(TREE, [], [padOf("n", by("a1"))]);

    const button = await waitFor(() => within(rowOf("auth")).getByRole("button", { name: "1 pads" }));

    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();
    await waitFor(() => expect(screen.getAllByRole("tooltip").map((tip) => tip.textContent)).toContain("1 pads"));
  });
});
