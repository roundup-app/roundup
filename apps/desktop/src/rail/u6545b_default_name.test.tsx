import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { door, event, workstream } from "../testing/nodes";
import { chooseFooter, mountRail, railCallsTo, rowNames } from "./railFixture";

afterEach(cleanup);

const createdNames = (app: Parameters<typeof railCallsTo>[0]): unknown[] => railCallsTo(app, "rail.createWorkstream");

const named = (...names: string[]) => names.map((name) => ({ name, parent: null }));

describe("u6545b a new Workstream's default name is numbered and unique among the Rail's roots", () => {
  it("u6545b_workstream_default_name_is_numbered", async () => {
    const tree: RailNode[] = [];
    const mounted = await mountRail(tree);
    let n = 0;
    mounted.app.handlers["rail.createWorkstream"] = () => door(`w${++n}`, "idle", "idle");
    mounted.app.handlers["rail.startDoor"] = () => door("x", "working", "starting");

    const create = async (count: number, name: string) => {
      await chooseFooter("Workstream");
      await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(count));
      tree.push(workstream(`w${count}`, { name }));
      mounted.app.emit(event({ name: "rail.changed" }));
      await waitFor(() => expect(mounted.rail.selected()).toBe(`w${count}`));
      await mounted.rail.settled();
    };

    await create(1, "Workstream");
    await create(2, "Workstream 2");
    await create(3, "Workstream 3");

    expect(createdNames(mounted.app)).toEqual(named("Workstream", "Workstream 2", "Workstream 3"));
    expect(rowNames()).toEqual(expect.arrayContaining(["Workstream", "Workstream 2", "Workstream 3"]));

    tree[1] = workstream("w2", { name: "renamed" });
    mounted.app.emit(event({ name: "rail.changed" }));
    await waitFor(() => expect(rowNames()).toContain("renamed"));
    await mounted.rail.settled();

    await chooseFooter("Workstream");
    await waitFor(() => expect(createdNames(mounted.app)).toEqual(named("Workstream", "Workstream 2", "Workstream 3", "Workstream 2")));
  });
});
