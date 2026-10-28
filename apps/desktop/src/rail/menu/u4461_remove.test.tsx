import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import {afterEach, expect, it } from "vitest";
import { todo } from "../../todos/testHarness";
import { padOf } from "../../pads/padsFixture";
import { RpcError } from "../../app/seam";
import { agent, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "../railFixture";

afterEach(cleanup);

it("u4461_the_question_has_three_answers_and_remove_this_is_default", async () => {
  const { app } = await mountRail([workstream("chosen")]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  expect(app.removalQuestions[0]).toMatchObject({ thisLabel: "Remove this", allLabel: "Remove all", cancelLabel: "Cancel" });
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it("u4461_the_message_names_what_remove_all_adds", async () => {
  const { app } = await mountRail([
    workstream("chosen"),
    agent("running", "working", "busy", { parent: "chosen" }),
    agent("dirty", "done", "finished", { parent: "chosen", worktree: { path: "/p/dirty", branch: "dirty", base: "main" } }),
    agent("ahead", "done", "finished", { parent: "chosen", worktree: { path: "/p/ahead", branch: "ahead", base: "main" } }),
  ]);

  app.handlers["agent.worktreeState"] = ({ id }) => ({ dirty: id === "dirty", ahead: id === "ahead" ? 2 : 0, behind: 0 });
  app.handlers["todo.list"] = () => [todo(1, { home: "chosen" })];
  app.handlers["pad.list"] = () => [{ ...padOf("notes", { kind: "agent", id: "running", parent: null }), home: "chosen" }];
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  expect(app.removalQuestions[0]!.message).toMatch(/Remove all also removes: 3 Agents, 1 open Todo.*1 Pads/);
  expect(app.removalQuestions[0]!.message).toMatch(/running.*Running/);
  expect(app.removalQuestions[0]!.message).toMatch(/dirty.*Uncommitted changes/);
  expect(app.removalQuestions[0]!.message).toMatch(/ahead.*2 ahead/);
});

it.each(["this", "all"] as const)("u4461_remove_this_and_remove_all_each_call_once_with_their_scope_%s", async answer => {
  const { app } = await mountRail([workstream("chosen"), workstream("other")]);
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
  const { app } = await mountRail([workstream("chosen")]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.answerRemoval).toBeTypeOf("function"));
  app.answerRemoval!("cancel");
  await waitFor(() => expect(document.activeElement).toBe(rowOf("chosen")));
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it("u4461_with_nothing_staying_all_three_are_offered", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("finished", "done", "finished", { parent: "chosen" })]);
  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  expect(app.removalQuestions[0]).toMatchObject({ thisLabel: "Remove this", allLabel: "Remove all", cancelLabel: "Cancel" });
  expect(app.removalQuestions[0]!.message).not.toContain("Remove all also");
});

it("u4461_a_failed_removal_shows_the_message", async () => {
  const { app } = await mountRail([workstream("chosen")]);
  app.handlers["rail.remove"] = () => { throw new RpcError(-32603, "Cannot remove: stop the process and retry"); };

  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(app.answerRemoval).toBeTypeOf("function"));
  app.answerRemoval!("all");
  await screen.findByText("Cannot remove: stop the process and retry");
  expect(rowOf("chosen")).toBeTruthy();
});

it("u4461_a_failed_native_question_authorizes_nothing_and_retries", async () => {
  const { app } = await mountRail([workstream("chosen")]);
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
