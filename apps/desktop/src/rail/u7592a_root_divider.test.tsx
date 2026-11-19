import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

it("u7592a_only_a_root_branch_carries_the_divider", async () => {
  await mountRail([
    workstream("a"), agent("a1", "working", "busy", { parent: "a" }),
    workstream("b"), agent("b1", "working", "busy", { parent: "b" }),
    workstream("c"), agent("c1", "working", "busy", { parent: "c" }), agent("c2", "working", "busy", { parent: "c1" }),
    agent("b2", "working", "busy", { parent: "b1" }),
  ]);
  const divided = ["a", "a1", "b", "b1", "b2", "c", "c1"].filter(id => rowOf(id).classList.contains("rail-root-divider"));

  expect(divided).toEqual(["b", "c"]);
});
