import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

it("dcl10_row_count_and_start_follow_stored_backlog", async () => {
  const { app, rail } = await mountRail([workstream("w", { name: "payments", waiting: 3 }), workstream("v", { name: "billing" }), agent("a", "idle", "ok", { parent: "v", name: "helper" })]);

  expect(rowOf("payments").querySelector(".rail-waiting")).not.toBeNull();
  expect(rowOf("billing").querySelector(".rail-waiting")).toBeNull();

  app.handlers["rail.startDoor"] = () => { throw new RpcError(-32003, "launch failed"); };

  await rail.startDoor("w");
  await waitFor(() => expect(rowOf("payments").querySelector(".rail-door-failure")).not.toBeNull());
  expect(rowOf("payments").querySelector(".rail-waiting")).not.toBeNull();
});
