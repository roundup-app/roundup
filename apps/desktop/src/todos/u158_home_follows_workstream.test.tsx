import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { withScopeRow } from "../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { event, workstream } from "../testing/nodes";
import { mountTodos, todo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const homeOf = (_id: number) => within(screen.getByRole("complementary", { name: "Drawer" })).queryByText(/^In /)?.textContent?.replace(/ Move.*$/, "").trim();

describe("u158 the Home line follows the Workstream", () => {
  it("u158_a_rename_changes_the_line_without_a_todo_event", async () => {
    let tree: RailNode[] = [workstream("r1", { name: "alpha" })];
    const mounted = await mountTodos([todo(2, { home: "r1" })], true, tree);

    mounted.app.handlers["rail.tree"] = () => withScopeRow(tree);
    await screen.findByText(/todo 2/);
    fireEvent.click(within(rowOf(2)).getByRole("button", { name: /todo 2/ }));
    await screen.findByText("Created by you");
    expect(homeOf(2)).toBe("In alpha");

    tree = [workstream("r1", { name: "gamma" })];
    mounted.app.emit(event({ name: "rail.changed" }));

    await waitFor(() => expect(homeOf(2)).toBe("In gamma"));
  });

  it("u158_removing_the_workstream_then_todo_updated_gives_project_root", async () => {
    let tree: RailNode[] = [workstream("r1", { name: "alpha" })];
    const mounted = await mountTodos([todo(2, { home: "r1" })], true, tree);

    mounted.app.handlers["rail.tree"] = () => withScopeRow(tree);
    await screen.findByText(/todo 2/);
    fireEvent.click(within(rowOf(2)).getByRole("button", { name: /todo 2/ }));
    await screen.findByText("Created by you");

    tree = [];
    mounted.app.emit(event({ name: "rail.changed" }));
    mounted.store.todos = [todo(2, { home: null })];
    mounted.app.emit(todoEvent("todo.updated", todo(2, { home: null })));

    await waitFor(() => expect(homeOf(2)).toBe("In Project root"));
  });

  it("u158_an_unknown_home_id_reads_project_root_and_never_the_id", async () => {
    await mountTodos([todo(2, { home: "ghost" })]);
    await screen.findByText(/todo 2/);
    fireEvent.click(within(rowOf(2)).getByRole("button", { name: /todo 2/ }));
    await screen.findByText("Created by you");

    expect(homeOf(2)).toBe("In Project root");
  });
});
