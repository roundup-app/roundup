import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { RpcError } from "../app/seam";
import type { DaemonExit } from "../app/seam";
import { mountRail, pinnedAdd, railCallsTo } from "./railFixture";
import { workstream } from "../testing/nodes";

afterEach(cleanup);

const disabled = () => pinnedAdd().matches('[aria-disabled="true"]');

describe("u391 the footer button keeps U9 and U25", () => {
  it("u391_pending_and_exited_disable_it", async () => {
    const mounted = await mountRail([]);
    let finish: (node: RailNode) => void = () => {};

    mounted.app.handlers["rail.createWorkstream"] = () => new Promise<RailNode>((done) => (finish = done));
    expect(disabled()).toBe(false);

    fireEvent.click(pinnedAdd());
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

  it("u391_the_error_line_stays_above_it", async () => {
    const mounted = await mountRail([workstream("g")]);

    mounted.app.handlers["rail.createWorkstream"] = () => {
      throw new RpcError(-32000, "boom");
    };

    fireEvent.click(pinnedAdd());

    const line = (await screen.findByText("boom")).closest<HTMLElement>(".ink") ?? screen.getByText("boom");
    const footer = pinnedAdd().parentElement!;

    expect(document.querySelector(".rail-scroll")!.contains(line)).toBe(false);
    expect(footer.previousElementSibling === line || footer.previousElementSibling?.contains(line)).toBe(true);
  });
});
