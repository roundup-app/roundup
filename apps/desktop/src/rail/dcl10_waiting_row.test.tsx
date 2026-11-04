import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

it("dcl10_row_count_and_start_follow_stored_backlog", async () => {
  await mountRail([workstream("w", { name: "payments", waiting: 3 }), workstream("v", { name: "billing" }), agent("a", "idle", "ok", { parent: "v", name: "helper" })]);

  expect(rowOf("payments").querySelector(".rail-attribution")).not.toBeNull();
  expect(rowOf("billing").querySelector(".rail-attribution")).toBeNull();
});
