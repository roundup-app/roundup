import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, info, workstream } from "../testing/nodes";
import { exitedTerminal, mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

describe("u164 the Agent's row counts its running Runs", () => {
  it("u164_the_agent_row_counts_running_runs_and_hides_zero", async () => {
    const tree = [workstream("w"), agent("busy", "working", "busy", { parent: "w" }), agent("idle", "working", "idle", { parent: "w", order: 1 }), agent("done", "working", "done", { parent: "w", order: 2 })];
    await mountRail(tree, [info("1", { owner: "busy" }), info("2", { owner: "busy" }), { ...exitedTerminal("3", 0), owner: "busy" }, { ...exitedTerminal("4", 0), owner: "done" }]);

    await screen.findByText("busy");

    expect(rowOf("busy").querySelector(".runs")?.textContent?.trim()).toBe("· 2");
    expect(rowOf("idle").querySelector(".runs")).toBeNull();
    expect(rowOf("done").querySelector(".runs")).toBeNull();
  });
});
