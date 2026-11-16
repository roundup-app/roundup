import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, door, event } from "../testing/nodes";
import { chooseAction, exitedTerminal, mountRail, railCallsTo, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const idle = (id: string) => agent(id, "idle", "idle");

/** The tree a test edits in place, as the Daemon's answers change it. */
const changes = async (tree: RailNode[], selecting: string) => {
  const mounted = await mountRail(tree);

  fireEvent.click(rowOf(selecting));
  await settled();
  expect(mounted.rail.selected()).toBe(selecting);

  const tell = async (next: RailNode[]) => {
    tree.splice(0, tree.length, ...next);
    mounted.app.emit(event({ name: "rail.changed" }));
    await settled();
  };

  return { ...mounted, tell };
};

describe("h7200 hand off", () => {
  it("h7200d_the_builders_row_replaces_the_callers_and_takes_its_selection", async () => {
    const [a, c, z] = [idle("a"), idle("c"), idle("z")];
    const { rail, tell } = await changes([a, c, z], "c");
    const b = agent("b", "working", "starting");

    await tell([a, b, c, z]);
    await tell([a, b, z]);

    await waitFor(() => expect(rail.selected()).toBe("b"));
    expect(() => rowOf("c")).toThrow();
    expect(rowOf("b").hasAttribute("data-selected")).toBe(true);
  });

  it("h7200d_selection_stays_when_the_caller_was_not_selected", async () => {
    const [a, c, z] = [idle("a"), idle("c"), idle("z")];
    const { rail, tell } = await changes([a, c, z], "z");
    const b = agent("b", "working", "starting");

    await tell([a, b, c, z]);
    await tell([a, b, z]);

    expect(rail.selected()).toBe("z");
  });

  it("h7200f_hand_off_shows_only_for_an_idle_or_needs_you_agent", async () => {
    const { app } = await mountRail(
      [
        idle("rests"),
        agent("asks", "needs-you", "question"),
        agent("busy", "working", "typing"),
        agent("gone", "done", "done"),
        door("door", "idle", "idle"),
      ],
      [exitedTerminal("gone", 0)],
    );

    const offered = (name: string) => {
      fireEvent.contextMenu(rowOf(name), { clientX: 1, clientY: 1 });

      return (app.shownMenus.at(-1)?.items ?? []).some(item => item.label === "Hand off" && item.enabled);
    };

    expect(["rests", "asks", "busy", "gone", "door"].map(offered)).toEqual([true, true, false, false, false]);
  });

  it("h7200f_hand_off_types_the_command_into_the_agent", async () => {
    const { app } = await mountRail([idle("c")]);

    await chooseAction(app, "c", "Hand off");

    await waitFor(() => expect(railCallsTo(app, "agent.prompt")).toEqual([{ id: "c", text: "/handoff" }]));
    expect(railCallsTo(app, "agent.handoff")).toEqual([]);
  });
});
