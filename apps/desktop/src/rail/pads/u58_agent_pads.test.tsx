import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { SCOPE_ROW } from "../../testing/nodes";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Pad } from "@contracts/pad/Pad";
import { DrawerHost } from "../../drawer/DrawerHost";
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

const padOf = (name: string, who: Actor): Pad => ({ incarnation: `fixture-${name}`, name, text: "", updated_at: 0, revision: 1, home: null });

/** The Rail, the Shelf and the Drawer over one fake Daemon whose Pads are `pads`. */
const mount = async (tree: RailNode[], pads: Pad[]) => {
  const state: PadStore = { pads, history: [] };
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(tree);
  Object.assign(app.handlers, padHandlers(state, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
  await showEverything(connected);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
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
  it("u58_the_rail_and_the_shelf_share_one_pad_list", async () => {
    const { app } = await mount(TREE, [padOf("notes", owner("a1"))]);

    await waitFor(() => expect(control(rowOf("auth"))).toBeNull());

    expect(app.calls.filter((call) => call.method === "pad.list")).toHaveLength(1);
  });

});
