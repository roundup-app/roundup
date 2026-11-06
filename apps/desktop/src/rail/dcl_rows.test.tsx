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
});

it("dcl1a_write_and_read_failures_offer_retry_and_unreadable_transcript_offers_open", async () => {
  await mountRail([
    door("w", "idle", "ready", { name: "payments", workstream_state: "idle" }),
    agent("a", "idle", "ready", { parent: "w", name: "writer", unreachable: "inbox write failed" }),
    agent("b", "idle", "ready", { parent: "w", name: "late", unreachable: "no receipt after 30 s" }),
    agent("c", "idle", "ready", { parent: "w", name: "reader", unreachable: "transcript unreadable" }),
  ]);

  const action = (row: string) => rowOf(row).querySelector<HTMLButtonElement>(".rail-unreachable button")!;

  expect(action("writer").getAttribute("aria-label")).toBe("Retry writer");
  expect(action("reader").getAttribute("aria-label")).toBe("Open reader");
});

it("dcl1a_retry_requests_one_reconciliation_and_selects_nothing", async () => {
  const { app, rail } = await mountRail([
    door("w", "idle", "ready", { name: "payments", workstream_state: "idle" }),
    agent("a", "idle", "ready", { parent: "w", name: "helper", unreachable: "inbox write failed" }),
    agent("c", "idle", "ready", { parent: "w", name: "reader", unreachable: "transcript unreadable" }),
  ]);

  const before = rail.selected();

  fireEvent.click(rowOf("helper").querySelector("button[data-button=quiet]")!);
  await waitFor(() => expect(railCallsTo(app, "message.retryDelivery")).toEqual([{ id: "a" }]));
  expect(rail.selected()).toBe(before);

  // The Workstream row shows the same action for the same Agent.
  fireEvent.click(rowOf("payments").querySelector("button[data-button=quiet]")!);
  await waitFor(() => expect(railCallsTo(app, "message.retryDelivery")).toHaveLength(2));

  // An unreadable transcript opens the Agent and asks for no pass.
  fireEvent.click(rowOf("reader").querySelector("button[data-button=quiet]")!);
  expect(rail.selected()).toBe("c");
  expect(railCallsTo(app, "message.retryDelivery")).toHaveLength(2);
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

it("u6248c_waiting_row_has_no_button", async () => {
  const { app } = await mountRail([
    agent("w", "blocked", "Claude is overloaded", { name: "waiting", resume: { at: Date.UTC(2026, 10, 5, 14, 5) } }),
    agent("x", "error", "Claude is overloaded; wait, then send a message to retry.", { name: "spent", resume: { at: null } }),
  ]);

  expect(rowOf("waiting").querySelector(".rail-resume")?.getAttribute("role")).toBe("status");
  expect(rowOf("waiting").querySelector(".rail-resume button")).toBeNull();

  const resume = rowOf("spent").querySelector<HTMLButtonElement>(".rail-resume button")!;
  expect(resume.getAttribute("aria-label")).toBe("Resume spent");
  expect(rowOf("spent").querySelectorAll("[data-failure], .rail-resume .reserved-status")).toHaveLength(1);
  fireEvent.click(resume);
  await waitFor(() => expect(railCallsTo(app, "message.send")).toHaveLength(1));
  expect(railCallsTo(app, "message.send")[0]).toMatchObject({ to: "x", kind: "note" });
});
