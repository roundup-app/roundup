import { expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { railTopology, sameTopology } from "./topology";

/** U3800d: the Daemon's answer to a move already drawn must not rebuild what the Rail built from the topology. */
it("u3800d_a_redraw_of_unchanged_rows_keeps_the_topology", () => {
  const rows = [workstream("w"), agent("a", "working", "a", { parent: "w", order: 1 }), agent("b", "working", "b", { parent: "w", order: 2 })];
  const before = railTopology(rows);

  expect(sameTopology(before, railTopology(rows.map(row => ({ ...row })).reverse()))).toBe(true);
  expect(sameTopology(before, railTopology([rows[0]!, { ...rows[1]!, parent: null }, rows[2]!]))).toBe(false);
  expect(sameTopology(before, railTopology(rows.slice(1)))).toBe(false);
});
