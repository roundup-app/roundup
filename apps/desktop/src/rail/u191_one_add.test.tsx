import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, door, event, workstream } from "../testing/nodes";
import { chooseFooter, chord, mountRail, railCallsTo, rowNames, rowOf, settled } from "./railFixture";

afterEach(cleanup);

describe("u162 one add opens a Workstream", () => {
  it("u191_new_workstream_creates_selects_and_starts_the_door_once", async () => {
    const tree: RailNode[] = [];
    const mounted = await mountRail(tree);
    mounted.app.handlers["rail.createWorkstream"] = () => door("made", "idle", "idle");
    mounted.app.handlers["rail.startDoor"] = () => door("made", "working", "starting");

    await chooseFooter("Workstream");
    await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toEqual([{ name: "workstream", parent: null }]));
    tree.push(workstream("made"));
    mounted.app.emit(event({ name: "rail.changed" }));

    await waitFor(() => expect(mounted.rail.selected()).toBe("made"));
    await waitFor(() => expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([{ id: "made" }]));
  });

  it("u191_the_icons_are_not_rail_rows_and_the_arrow_keys_skip_them", async () => {
    const mounted = await mountRail([workstream("g"), workstream("h")]);
    mounted.rail.select("g");

    expect(rowNames()).toEqual(["g", "h"]);
    const row = rowOf("g");

    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    await settled();
    expect(document.activeElement).toBe(rowOf("h"));
  });

  it("u191_cmd_n_keep_their_parent_rule_with_no_workstream", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");

    chord("n");
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: null, model: null, effort: null }]));
  });

});
