import { describe, expect, it } from "vitest";
import { layoutRail } from "./layout";
import { agent, workstream, MINUTE, NOW } from "../testing/nodes";

/** U357: one vertical line shared by siblings, so a nested `✓ n done` line sits on it too. */

const done = { kind: "done" as const, label: "finished", since: NOW - 60 * MINUTE, finished: "0" };

describe("u357 fold line", () => {
  it("u357_a_nested_done_line_continues_its_ancestors_connector", () => {
    const nodes = [
      workstream("g", { order: 0 }),
      workstream("h", { parent: "g", order: 0 }),
      agent("x", "idle", "i", { parent: "h", order: 0 }),
      agent("old", "done", "finished", { parent: "h", order: 1, status: done, final_text: { attempt: "1", turn: "1", finished: "0", kind: "empty" } }),
      agent("y", "idle", "i", { parent: "g", order: 1 }),
    ];

    const rows = layoutRail(nodes, { collapsed: new Set(), unfolded: new Set(), now: NOW });
    const fold = rows.find((row) => row.kind === "fold");
    const x = rows.find((row) => row.kind === "node" && row.node.id === "x");

    expect(fold).toMatchObject({ depth: 2, trail: [true] });
    expect(x).toMatchObject({ trail: [true, true] });
  });
});
