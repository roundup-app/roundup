import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { SCOPE_ROW } from "../../testing/nodes";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Pad } from "@contracts/pad/Pad";
import { DrawerHost } from "../../drawer/DrawerHost";
import { Keys } from "../../keys/Keys";
import { Pads } from "../../pads/Pads";
import { ConnectedProjectContext, connectProject } from "../../state/connectedProject";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, event, NOW } from "../../testing/nodes";
import { padHandlers } from "../../testing/stores";
import type { PadStore } from "../../testing/stores";
import { Rail } from "../Rail";
import { rowOf, settled } from "../railFixture";

afterEach(cleanup);

const owner = (id: string): Actor => ({ kind: "agent", id, parent: null });

const USER: Actor = { kind: "user", id: "you", parent: null };

const padOf = (name: string, who: Actor): Pad => ({ name, owner: who, text: "", updated_at: 0, revision: 1, home: null });

/** The Rail, `Keys`, the Shelf and the Drawer over one fake Daemon whose Pads are `pads`. */
const mount = async (tree: RailNode[], pads: Pad[]) => {
  const state: PadStore = { pads, history: [] };
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(tree);
  Object.assign(app.handlers, padHandlers(state, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
  await showEverything(connected);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Keys />
      <Rail />
      <Pads />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  return { app, state, connected };
};

const TREE = [agent("a1", "working", "x", { name: "auth" }), agent("a2", "working", "x", { name: "docs", order: 1 })];

const control = (row: HTMLElement) => within(row).queryByRole("button", { name: /(pads|todos)$/ });

const shelf = () => within(screen.getByRole("region", { name: "Pads" }));

describe("u58 an Agent's Pads under it", () => {
  it("u58_the_control_counts_the_agents_pads_and_is_absent_at_zero", async () => {
    await mount(TREE, [padOf("n1", owner("a1")), padOf("n2", owner("a1")), padOf("u", USER)]);

    await waitFor(() => expect(control(rowOf("auth"))?.textContent?.trim()).toBe("2"));
    expect(control(rowOf("docs"))).toBeNull();
  });

  it("u58_the_control_is_collapsed_at_rest_and_a_click_shows_and_folds_the_pads_one_level_deeper", async () => {
    await mount(TREE, [padOf("notes", owner("a1"))]);

    const button = await waitFor(() => control(rowOf("auth")) ?? Promise.reject(new Error("no control")));

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(within(screen.getByRole("tree", { name: "Rail" })).queryByRole("button", { name: "notes" })).toBeNull();

    fireEvent.click(button);

    const pad = within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: "notes" });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(rowOf("auth").nextElementSibling).toBe(pad.closest("[data-pads]"));

    fireEvent.click(button);

    expect(within(screen.getByRole("tree", { name: "Rail" })).queryByRole("button", { name: "notes" })).toBeNull();
  });

  it("u58_the_control_does_not_select_the_row_or_reorder_the_agents", async () => {
    const { connected } = await mount(TREE, [padOf("notes", owner("a1"))]);

    fireEvent.click(await waitFor(() => control(rowOf("auth")) ?? Promise.reject(new Error("no control"))));

    expect(connected.rail.selected()).toBeNull();
    expect([...document.querySelectorAll("[role=tree] :is([data-part=item], [data-part=branch-control])[data-id]")].map((row) => row.getAttribute("data-id"))).toEqual(["a1", "a2", SCOPE_ROW]);
  });

  it("u58_a_click_on_a_pad_opens_its_drawer_and_leaves_the_selection", async () => {
    const { connected } = await mount(TREE, [padOf("notes", owner("a1"))]);

    fireEvent.click(await waitFor(() => control(rowOf("auth")) ?? Promise.reject(new Error("no control"))));
    fireEvent.click(within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: "notes" }));

    const drawer = await screen.findByLabelText("Drawer");

    expect(await within(drawer).findByText("notes")).toBeTruthy();
    expect(connected.rail.selected()).toBeNull();
  });

  it("u58_clicking_the_owner_mark_in_the_drawer_calls_pad_setOwner_and_moves_the_pad_to_the_shelf", async () => {
    const { app } = await mount(TREE, [padOf("notes", owner("a1"))]);

    fireEvent.click(await waitFor(() => control(rowOf("auth")) ?? Promise.reject(new Error("no control"))));
    fireEvent.click(within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: "notes" }));
    fireEvent.click(await within(await screen.findByLabelText("Drawer")).findByRole("button", { name: "Make yours" }));

    await shelf().findByText("notes");

    expect(app.calls.filter((call) => call.method === "pad.setOwner")).toEqual([
      { method: "pad.setOwner", params: { name: "notes", owner: USER } },
    ]);
    expect(control(rowOf("auth"))).toBeNull();
  });

  it("u58_the_rail_and_the_shelf_share_one_pad_list", async () => {
    const { app } = await mount(TREE, [padOf("notes", owner("a1"))]);

    await waitFor(() => expect(control(rowOf("auth"))).not.toBeNull());

    expect(app.calls.filter((call) => call.method === "pad.list")).toHaveLength(1);
  });

  it("u58_right_on_a_leaf_agent_shows_its_pads_and_left_folds_them_before_it_selects_the_parent", async () => {
    await mount(TREE, [padOf("notes", owner("a1"))]);
    await waitFor(() => expect(control(rowOf("auth"))).not.toBeNull());

    const row = rowOf("auth");

    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    await settled();
    expect(within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: "notes" })).toBeTruthy();

    fireEvent.keyDown(row, { key: "ArrowLeft" });
    await settled();
    expect(within(screen.getByRole("tree", { name: "Rail" })).queryByRole("button", { name: "notes" })).toBeNull();
    expect(document.activeElement).toBe(row);
  });
});
