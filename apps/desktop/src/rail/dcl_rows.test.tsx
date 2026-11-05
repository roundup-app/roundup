import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { leaderKey } from "../keys/leaderFixture";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

it("dcl1_failure_reaches_agent_and_workstream_rows", async () => {
  const { rail } = await mountRail([
    door("w", "idle", "ready", { name: "payments", workstream_state: "idle" }),
    agent("a", "idle", "ready", { parent: "w", name: "helper", unreachable: "inbox write failed" }),
  ]);

  for (const name of ["payments", "helper"]) expect(rowOf(name).querySelector(".rail-unreachable")).not.toBeNull();

  // The recovery action takes the user to the Agent the Message did not reach.
  fireEvent.click(rowOf("helper").querySelector("button[data-button=quiet]")!);
  expect(rail.selected()).toBe("a");
});

it("dcl2_permission_action_opens_requesting_terminal", async () => {
  const { rail } = await mountRail([
    door("w", "idle", "ready", { name: "payments", workstream_state: "needs-you" }),
    agent("a", "working", "busy", { parent: "w", name: "busy" }),
    agent("b", "needs-you", "permission", { parent: "w", name: "asker", terminal_id: "t-b" }),
  ]);

  // The row shows the Daemon's state; the Door's own Kind stays idle.
  expect(rowOf("payments").dataset.kind).toBe("needs-you");

  leaderKey("KeyJ");

  expect(rail.selected()).toBe("b");
  expect(rail.nodes.find(node => node.id === "b")?.terminal_id).toBe("t-b");
});

it("dcl8_row_start_and_waiting_count_follow_stored_backlog", async () => {
  const { app } = await mountRail([workstream("w", { name: "payments", waiting: 2 })]);

  expect(rowOf("payments").querySelector(".rail-waiting")).not.toBeNull();

  fireEvent.click(rowOf("payments").querySelector("button[aria-label=Start]")!);

  await waitFor(() => expect(railCallsTo(app, "rail.startDoor")).toEqual([{ id: "w" }]));
});
