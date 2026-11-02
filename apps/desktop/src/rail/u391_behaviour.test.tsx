import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import type { DaemonExit } from "../app/seam";
import { chooseFooter, mountRail, pinnedAdd, railCallsTo } from "./railFixture";
import { workstream } from "../testing/nodes";

afterEach(cleanup);

const disabled = () => pinnedAdd().matches('[aria-disabled="true"]');

describe("u391 the footer button keeps U9 and U25", () => {
  it("u391_pending_and_exited_disable_it", async () => {
    const mounted = await mountRail([]);
    let finish: (node: RailNode) => void = () => {};

    mounted.app.handlers["rail.createWorkstream"] = () => new Promise<RailNode>((done) => (finish = done));
    expect(disabled()).toBe(false);

    await chooseFooter("Workstream");
    fireEvent.click(pinnedAdd());
    await waitFor(() => expect(disabled()).toBe(true));
    expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(1);

    finish(workstream("made"));
    cleanup();

    const [exit, setExit] = createSignal<DaemonExit | null>(null);
    const exited = await mountRail([], [], exit);

    expect(disabled()).toBe(false);
    setExit({ code: 1 });
    expect(disabled()).toBe(true);
    fireEvent.click(pinnedAdd());
    expect(railCallsTo(exited.app, "rail.createWorkstream")).toEqual([]);
  });

});
