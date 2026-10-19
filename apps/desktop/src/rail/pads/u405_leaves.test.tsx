import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../../drawer/DrawerHost";
import { ConnectedProjectContext, connectProject } from "../../state/connectedProject";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, event, NOW } from "../../testing/nodes";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { padHandlers, todoHandlers } from "../../testing/stores";
import { todo } from "../../todos/testHarness";
import { Rail } from "../Rail";
import { rowOf } from "../railFixture";

afterEach(cleanup);

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const padOf = (name: string): Pad => ({ incarnation: `fixture-${name}`, name, owner: by("a1"), text: "", updated_at: 0, revision: 1, home: null });

const mount = async (todos: Todo[], pads: Pad[]) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow([agent("a1", "working", "x", { name: "auth" }), agent("a2", "idle", "x", { name: "docs", order: 1 })]);
  Object.assign(app.handlers, padHandlers({ pads, history: [] }, (data) => app.emit(event(data))));
  Object.assign(app.handlers, todoHandlers({ todos }, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
  await showEverything(connected);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Rail />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider>
  ));
  await connected.rail.settled();

  const control = await waitFor(() => rowOf("auth").querySelector<HTMLElement>("[data-pads-control]") ?? Promise.reject(new Error("no control")));

  fireEvent.click(control);
};

const leaves = () => [...document.querySelectorAll<HTMLElement>(".rail-leaf")];

describe("u405 owned Pads and Todos hang as leaves", () => {
  it("u405_leaves_hang_one_step_under_their_agent", async () => {
    await mount([todo(2, { creator: by("a1") }), todo(1, { creator: by("a1") })], [padOf("notes"), padOf("plan")]);

    expect(leaves().map((leaf) => leaf.dataset["leaf"])).toEqual(["pad", "pad", "todo", "todo"]);
    expect(leaves()[0]!.nextElementSibling).toBe(leaves()[1]);
    expect(rowOf("auth").nextElementSibling?.contains(leaves()[0]!)).toBe(true);
    expect(leaves().map((leaf) => leaf.querySelector(".rail-branch")?.getAttribute("data-last"))).toEqual(["false", "false", "false", "true"]);
    expect(leaves().every((leaf) => leaf.querySelector(".rail-branch") !== null)).toBe(true);
  });

  it("u405_a_pad_leaf_is_a_diamond", async () => {
    await mount([], [padOf("notes")]);

    const pad = screen.getByRole("button", { name: "notes" });

    expect(pad.querySelector("svg")).not.toBeNull();
    expect(pad.textContent).toBe("notes");

    fireEvent.click(pad);
    expect(await screen.findByLabelText("Drawer")).toBeTruthy();
  });

  it("u405_a_todo_leaf_is_its_kinds_glyph", async () => {
    await mount([todo(1, { creator: by("a1") }), todo(3, { creator: by("a1"), blockers: [1], blocked: true })], []);

    const [open, blocked] = leaves();

    expect(open!.querySelector(".glyph")).not.toBeNull();
    expect(blocked!.querySelector(".glyph")).not.toBeNull();
    expect(blocked!.textContent).toContain("Waits on");
    expect(screen.getByRole("button", { name: /#1 todo 1/ })).toBeTruthy();
  });

  it("u405_folding_the_leaves_removes_them_and_no_row_above_moves", async () => {
    await mount([todo(1, { creator: by("a1") })], [padOf("notes")]);

    const above = screen.getAllByRole("treeitem").map((row) => row.getAttribute("data-id")).slice(0, 2);

    fireEvent.click(rowOf("auth").querySelector<HTMLElement>("[data-pads-control]")!);

    expect(leaves()).toHaveLength(0);
    expect(screen.getAllByRole("treeitem").map((row) => row.getAttribute("data-id")).slice(0, 2)).toEqual(above);
  });
});
