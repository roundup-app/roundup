import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import {afterEach, expect, it } from "vitest";
import { createFakeApp } from "../../testing/fakeApp";
import { goesLine, staysLine, judgeRemoval, removalQuestion } from "./removal";
import { todo } from "../../todos/testHarness";
import { padOf } from "../../pads/padsFixture";
import { RpcError } from "../../app/seam";
import { agent, info, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "../railFixture";

afterEach(cleanup);

it("u4601_buttons_follow_what_stays_nonempty", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  expect(app.removalQuestions[0]).toMatchObject({ thisLabel: "Remove this", allLabel: "Remove all", cancelLabel: "Cancel" });
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it("u4601_the_native_request_uses_the_plan", async () => {
  const { app } = await mountRail([
    workstream("chosen"),
    agent("running", "working", "busy", { parent: "chosen" }),
    agent("dirty", "done", "finished", { parent: "chosen", worktree: { path: "/p/dirty", branch: "dirty", base: "main" } }),
    agent("ahead", "done", "finished", { parent: "chosen", worktree: { path: "/p/ahead", branch: "ahead", base: "main" } }),
  ], [info("live-shell", { owner: "chosen" })]);

  app.handlers["agent.worktreeState"] = ({ id }) => ({ dirty: id === "dirty", ahead: id === "ahead" ? 2 : 0, behind: 0 });
  app.handlers["todo.list"] = () => [todo(1, { home: "chosen" })];
  app.handlers["pad.list"] = () => [{ ...padOf("notes", { kind: "agent", id: "running", parent: null }), home: "chosen" }];
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  const plan = await judgeRemoval(app, await app.rpc("rail.tree", null), "chosen");
  expect(app.removalQuestions[0]).toMatchObject({
    ...removalQuestion(plan, "chosen"),
  });
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it.each(["this", "all"] as const)("u4461_remove_this_and_remove_all_each_call_once_with_their_scope_%s", async answer => {
  const { app } = await mountRail([workstream("chosen"), workstream("other"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });
  fireEvent.click(rowOf("chosen"));
  await settled();
  rowOf("chosen").focus();
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  fireEvent.click(rowOf("other"));
  await settled();
  fireEvent.contextMenu(rowOf("other"));
  await app.pickMenu("Remove");
  app.answerRemoval!(answer);
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([answer === "all" ? { id: "chosen", scope: "all" } : { id: "chosen" }]));
  expect(app.removalQuestions).toHaveLength(1);
});

it("u4461_cancel_and_escape_call_nothing", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.answerRemoval).toBeTypeOf("function"));
  app.answerRemoval!("cancel");
  await waitFor(() => expect(document.activeElement).toBe(rowOf("chosen")));
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it.each([false, true])("u4601_buttons_follow_what_stays_empty_answer_%s", async answer => {
  const { app } = await mountRail([workstream("chosen"), agent("finished", "done", "finished", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.questions).toHaveLength(1));
  expect(app.questions[0]).toMatchObject({ okLabel: "Remove", cancelLabel: "Cancel" });
  expect(app.removalQuestions).toEqual([]);
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
  app.answerQuestion!(answer);
  await waitFor(() => expect(document.activeElement).toBe(rowOf("chosen")));
  expect(railCallsTo(app, "rail.remove")).toEqual(answer ? [{ id: "chosen" }] : []);
});

it("u4461_a_failed_removal_shows_the_message", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  app.handlers["rail.remove"] = () => { throw new RpcError(-32003, "Cannot remove: stop the process and retry"); };

  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.answerRemoval).toBeTypeOf("function"));
  app.answerRemoval!("all");
  await screen.findByText("Cannot remove: stop the process and retry");
  expect(rowOf("chosen")).toBeTruthy();
});

it("u4461_a_failed_native_question_authorizes_nothing_and_retries", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  app.questionFailure = new RpcError(-32603, "Alert unavailable; retry");
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await screen.findByText("Alert unavailable; retry");
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
  app.questionFailure = null;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(app.removalQuestions).toHaveLength(2));
  app.answerRemoval!("cancel");
  await waitFor(() => expect(document.activeElement).toBe(rowOf("chosen")));
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it.each([
  { agents: [], done: 0, open: 0, expected: ["Goes: workstream", null] },
  { agents: [agent("new-agent", "working", "busy", { parent: "workstream" })], done: 1, open: 1, expected: ["Goes: workstream, 1 done Todo", "Stays: new-agent, 1 open Todo"] },
  { agents: [agent("finished", "done", "finished", { parent: "workstream" }), agent("alpha", "working", "busy", { parent: "workstream" }), agent("beta", "working", "busy", { parent: "workstream" })], done: 2, open: 3, expected: ["Goes: workstream, finished, 2 done Todos", "Stays: alpha, beta, 3 open Todos"] },
])("u4601_three_plans_have_two_list_copy_%#", async fixture => {
  const app = createFakeApp();
  app.handlers["todo.list"] = () => Array.from({ length: fixture.done + fixture.open }, (_, index) => todo(index + 1, { home: "workstream", done: index < fixture.done }));
  const plan = await judgeRemoval(app, [workstream("workstream", { terminal_id: "live-shell" }), ...fixture.agents], "workstream");
  expect(removalQuestion(plan, "workstream")).toEqual({
    title: "Remove “workstream”?",
    message: fixture.expected.filter(Boolean).join("\n"),
    cancelLabel: "Cancel",
    ...(fixture.open ? { thisLabel: "Remove this", allLabel: "Remove all" } : { okLabel: "Remove" }),
  });
});

it.each([1, 2])("u4601_pad_counts_use_singular_and_plural_%s", async count => {
  const app = createFakeApp();
  app.handlers["pad.list"] = () => Array.from({ length: count }, (_, index) => ({ ...padOf(`notes-${index}`, { kind: "user", id: "you", parent: null }), home: "chosen" }));
  const plan = await judgeRemoval(app, [workstream("chosen")], "chosen");
  expect(goesLine(plan, "chosen")).toBe(count === 1 ? "Goes: chosen, 1 Pad" : "Goes: chosen, 2 Pads");
});

it("u4601_the_lists_follow_the_removal_plan", async () => {
  const app = createFakeApp();
  app.handlers["agent.worktreeState"] = ({ id }) => ({ dirty: id === "dirty", ahead: id === "ahead" ? 2 : 0, behind: 0 });
  app.handlers["todo.list"] = () => [todo(1, { home: "chosen", done: true }), todo(2, { home: "chosen" })];
  app.handlers["pad.list"] = () => ["finished", "dirty", "ahead"].map(id => ({ ...padOf(id, { kind: "agent", id, parent: null }), home: "chosen" }));

  const plan = await judgeRemoval(app, [
    workstream("chosen"),
    workstream("group", { parent: "chosen" }),
    agent("finished", "done", "finished", { parent: "group" }),
    agent("running", "working", "busy", { parent: "group" }),
    ...["dirty", "ahead"].map(id => agent(id, "done", "finished", { parent: "group", worktree: { path: `/p/${id}`, branch: id, base: "main" } })),
  ], "chosen");

  expect([goesLine(plan, "chosen"), staysLine(plan)]).toEqual([
    "Goes: chosen, finished, 1 done Todo, 3 Pads",
    "Stays: running, dirty, ahead, 1 open Todo",
  ]);
});

it.each(["pad.list", "todo.list"] as const)("u5301a_a_failed_pad_or_todo_read_opens_the_confirm_naming_it_%s", async method => {
  const { app } = await mountRail([workstream("chosen"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });
  app.handlers[method] = () => { throw new RpcError(-32603, `no reply to ${method} within 5s`); };

  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));

  const unread = method === "pad.list" ? "Pads could not be read." : "Todos could not be read.";
  expect(app.removalQuestions[0]!.message.split("\n")).toContain(unread);
  expect(app.removalQuestions[0]!.message).not.toMatch(/\b0 /);
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
  app.answerRemoval!("all");
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "chosen", scope: "all" }]));
});
