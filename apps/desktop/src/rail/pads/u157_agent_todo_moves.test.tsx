import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import { DrawerHost } from "../../drawer/DrawerHost";
import { Keys } from "../../keys/Keys";
import { Pads } from "../../pads/Pads";
import { ConnectedProjectContext, connectProject } from "../../state/connectedProject";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, event, NOW, workstream } from "../../testing/nodes";
import { todoHandlers } from "../../testing/stores";
import type { TodoStore } from "../../testing/stores";
import { Todos } from "../../todos/Todos";
import { todo } from "../../todos/testHarness";
import { Rail } from "../Rail";
import { rowOf } from "../railFixture";

afterEach(cleanup);

describe("u157 a Todo created by an Agent", () => {
  it("u157_a_todo_created_by_an_agent_moves_and_stays_under_its_agent", async () => {
    const creator = { kind: "agent" as const, id: "a1", parent: null };
    const store: TodoStore = { todos: [todo(1, { creator })] };
    const app = createFakeApp();

    app.handlers["rail.tree"] = () => withScopeRow([agent("a1", "working", "x", { name: "auth" }), workstream("r1", { name: "alpha", order: 1 })]);
    Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

    const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
    await showEverything(connected);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Keys />
        <Rail />
        <Pads />
        <Todos />
        <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
      </ConnectedProjectContext.Provider>
    ));
    await connected.rail.settled();
    fireEvent.click(await waitFor(() => within(rowOf("auth")).queryByRole("button", { name: /(pads|todos)$/ }) ?? Promise.reject(new Error("no control"))));

    const nested = screen.getByRole("tree", { name: "Rail" }).querySelector<HTMLElement>('[data-todo="1"]')!;

    fireEvent.contextMenu(nested);
    await app.pickMenu("alpha");
    await waitFor(() => expect(store.todos[0]?.home).toBe("r1"));
    expect(document.querySelector('[data-todo="1"]')).not.toBeNull();
    expect(document.querySelector('[data-shelf-row][data-id="1"]')).not.toBeNull();
    expect(app.calls.filter((c) => c.method === "todo.move").map((c) => c.params)).toEqual([{ id: 1, home: "r1" }]);
    expect(store.todos[0]?.creator).toEqual(creator);
  });
});
