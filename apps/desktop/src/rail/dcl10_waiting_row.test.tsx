import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

it("dcl10_row_count_and_start_follow_stored_backlog", async () => {
  const { app, rail } = await mountRail([workstream("w", { name: "payments", waiting: 3 }), workstream("v", { name: "billing" }), agent("a", "idle", "ok", { parent: "v", name: "helper" })]);

  expect((rowOf("payments").querySelector(".row-state [role=img]")?.getAttribute("aria-label") ?? "")).toContain("Door stopped · 3 waiting");
  expect((rowOf("billing").querySelector(".row-state [role=img]")?.getAttribute("aria-label") ?? "")).not.toContain("waiting");

  app.handlers["rail.startDoor"] = () => { throw new RpcError(-32003, "launch failed"); };

  await rail.startDoor("w");
  await waitFor(() => expect((rowOf("payments").querySelector(".row-state [role=img]")?.getAttribute("aria-label") ?? "")).toContain("launch failed"));
  expect((rowOf("payments").querySelector(".row-state [role=img]")?.getAttribute("aria-label") ?? "")).toContain("Door stopped · 3 waiting");
  expect(rowOf("payments").querySelector(".rail-door-failure, .reserved-line, [data-failure]")).toBeNull();
});
