import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream, NOW, event } from "../testing/nodes";
import { mountRail, rowNames, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const empty = { attempt: "1", turn: "1", finished: "1", kind: "empty" as const };

it("u5483a_working_idle_five_minutes_then_working_returns", async () => {
  const child = agent("child", "working", "working", { parent: "stream", final_text: empty });
  const { app, rail, setNow } = await mountRail([workstream("stream"), child, agent("busy", "working", "working", { parent: "stream", order: 1 })]);
  rail.select("child");
  const calls = app.calls.length;
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "idle", label: "idle", since: NOW, finished: "1" } } }));
  setNow(NOW + 299_999);
  expect(rowNames()).toContain("child");
  setNow(NOW + 300_000);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "busy"]));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "working", label: "working", since: NOW + 300_000, finished: "1" } } }));
  expect(rowNames()).toEqual(["stream", "child", "busy"]);
  expect(rail.selected()).toBe("child");
  expect(app.calls.slice(calls).filter(call => !["message.list", "pad.list", "todo.list"].includes(call.method))).toEqual([]);
});

it("u5483b_click_opens_and_closes_the_branch", async () => {
  await mountRail([workstream("stream"), agent("child", "done", "done", { parent: "stream", final_text: { ...empty, finished: "0" } })]);
  const branch = () => screen.getByRole("treeitem", { name: /idle/ });
  await waitFor(() => expect(branch().getAttribute("aria-expanded")).toBe("false"));
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await settled();
  expect(rowNames()).toContain("child");
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await settled();
  expect(rowNames()).not.toContain("child");
  await waitFor(() => expect(branch().getAttribute("aria-expanded")).toBe("false"));
  expect(rowOf("stream")).toBeDefined();
});

it("u5483c_unknown_final_text_stays_visible", async () => {
  const child = agent("child", "done", "finished", { parent: "stream" });

  await mountRail([workstream("stream"), child]);
  await settled();
  expect(rowNames()).toContain("child");
});

// Rail receives evidence, never assistant text. The companion real-Daemon observer
// proves these text classes reach that boundary through the Adapter.
it.each([
  { reply: "empty", kind: "empty", visible: false },
  { reply: "ordinary final statement", kind: "present", visible: true },
  { reply: "Should I publish three pages or five", kind: "present", visible: true },
  { reply: "multiline question beyond the excerpt", kind: "present", visible: true },
  { reply: "unavailable", kind: "unknown", visible: true },
] as const)("u5483c_final_text_without_a_question_mark_stays_visible $reply", async ({ kind, visible }) => {
  const { setNow } = await mountRail([workstream("stream"), agent("child", "idle", "idle", {
    parent: "stream", final_text: { ...empty, finished: "0", kind },
  })]);

  setNow(NOW + 300_000);
  await settled();
  expect(rowNames().includes("child")).toBe(visible);
});

it("u5483c_clarification_never_folds", async () => {
  await mountRail([workstream("stream"), agent("child", "done", "finished", { parent: "stream", work: { kind: "clarification", question: "Choose the scope" }, final_text: { ...empty, finished: "0" } })]);
  await settled();
  expect(rowNames()).toContain("child");
});

it.each(["needs-you", "error", "blocked"] as const)("u5483b_attention_and_work_return_immediately %s", async kind => {
  const { app } = await mountRail([workstream("stream"), agent("child", "done", "finished", { parent: "stream", final_text: { ...empty, finished: "0" } })]);
  await waitFor(() => expect(rowNames()).not.toContain("child"));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind, label: kind, since: NOW, finished: "0" } } }));
  expect(rowNames()).toEqual(["stream", "child"]);
  expect(screen.queryByRole("treeitem", { name: /idle/ })).toBeNull();
});

it("u5483a_only_idle_or_done_workstream_children_fold", async () => {
  await mountRail([workstream("stream"), agent("root", "done", "finished", { final_text: { ...empty, finished: "0" } }), ...(["working", "needs-you", "error", "blocked"] as const).map(kind => agent(kind, kind, kind, { parent: "stream", final_text: { ...empty, finished: "0" } }))]);
  await settled();
  expect(rowNames()).toEqual(["stream", "working", "needs-you", "error", "blocked", "root"]);
});

it("u5483b_open_choice_survives_membership_changes", async () => {
  const child = agent("child", "done", "finished", { parent: "stream", final_text: { ...empty, finished: "0" } });
  const { app, rail } = await mountRail([workstream("stream"), child]);
  await waitFor(() => expect(screen.getByRole("treeitem", { name: /idle/ })).toBeDefined());
  fireEvent.click(document.querySelector('.rail-fold')!);
  await waitFor(() => expect(rowNames()).toContain("child"));
  rail.toggleCollapsed("stream");
  rail.toggleCollapsed("stream");
  expect(rowNames()).toContain("child");
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "working", label: "working", since: NOW, finished: "0" } } }));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "done", label: "finished", since: NOW + 1, finished: "0" } } }));
  expect(rowNames()).toContain("child");
  expect(screen.getByRole("treeitem", { name: /idle/ }).getAttribute("aria-expanded")).toBe("true");
});


it("u5483c_unanswered_question_never_folds", async () => {
  const { app, setNow } = await mountRail([workstream("stream"), agent("child", "working", "working", { parent: "stream", final_text: empty })]);
  const question = { id: 1, from: { kind: "agent" as const, id: "child", parent: "stream" }, to: "you", kind: "question" as const, body: "Choose scope", replyTo: null, status: "delivered" as const, reason: null, at: NOW };
  app.handlers["message.list"] = () => [question];
  app.emit(event({ name: "message.sent", data: question }));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "idle", label: "idle", since: NOW, finished: "1" } } }));
  setNow(NOW + 300_000);
  await settled();
  expect(rowNames()).toContain("child");
  const reply = { ...question, id: 2, from: { kind: "user" as const, id: "you", parent: null }, to: "child", kind: "note" as const, replyTo: 1, at: NOW + 1 };
  app.handlers["message.list"] = () => [question, reply];
  app.emit(event({ name: "message.sent", data: reply }));
  await settled();
  expect(rowNames()).toContain("child");
});

it("u5483a_idle_must_be_continuous", async () => {
  const { app, setNow } = await mountRail([workstream("stream"), agent("child", "idle", "idle", { parent: "stream", final_text: { ...empty, finished: "0" } })]);
  setNow(NOW + 299_999);
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "blocked", label: "blocked", since: NOW + 299_999, finished: "0" } } }));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "idle", label: "idle", since: NOW + 300_000, finished: "0" } } }));
  setNow(NOW + 599_999);
  await settled();
  expect(rowNames()).toContain("child");
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "4", status: { kind: "idle", label: "renamed observation", since: NOW + 300_000, finished: "0" } } }));
  setNow(NOW + 600_000);
  expect(rowNames()).not.toContain("child");
});

it("u5483a_done_and_idle_share_one_branch", async () => {
  await mountRail([workstream("stream"), agent("done", "done", "finished", { parent: "stream", order: 0, final_text: { ...empty, finished: "0" } }), agent("idle", "idle", "idle", { parent: "stream", order: 1, status: { kind: "idle", label: "idle", since: NOW - 300_000, finished: "0" }, final_text: { ...empty, finished: "0" } }), agent("busy", "working", "working", { parent: "stream", order: 2 })]);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "busy"]));
  expect(screen.getAllByRole("treeitem", { name: /idle/ })).toHaveLength(1);
  fireEvent.click(document.querySelector('.rail-fold')!);
  await waitFor(() => expect(rowNames()).toEqual(["stream", "busy", "done", "idle"]));
});

it("u5483a_workstreams_keep_separate_folds", async () => {
  await mountRail([workstream("first"), workstream("second", { order: 1 }), ...["first", "second"].map(parent => agent(`${parent}-child`, "done", "finished", { parent, final_text: { ...empty, finished: "0" } }))]);
  await waitFor(() => expect(screen.getAllByRole("treeitem", { name: /idle/ })).toHaveLength(2));
  fireEvent.click(document.querySelector('[data-id="fold:first"] [data-part="branch-control"]')!);
  await waitFor(() => expect(rowNames()).toContain("first-child"));
  expect(rowNames()).not.toContain("second-child");
});

it("u5483c_resuming_clears_only_the_previous_turn", async () => {
  const child = agent("child", "done", "finished", { parent: "stream", final_text: { ...empty, finished: "0", kind: "present" } });
  const { app, rail, setNow } = await mountRail([workstream("stream"), child]);
  await settled();
  expect(rowNames()).toContain("child");
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "working", label: "working", since: NOW, finished: "0" } } }));
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "idle", label: "idle", since: NOW + 1, finished: "1" } } }));
  setNow(NOW + 300_001);
  expect(rowNames()).toContain("child");
  app.handlers["rail.tree"] = () => [workstream("stream"), { ...child, status: { kind: "idle", label: "idle", since: NOW + 1, finished: "1" }, status_revision: "3", final_text: { ...empty, turn: "2" } }];
  app.emit(event({ name: "rail.changed" }));
  await rail.settled();
  expect(rowNames()).not.toContain("child");
});
