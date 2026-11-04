import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, info, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "../railFixture";

afterEach(cleanup);

const names = (count: number) => Array.from({ length: count }, (_, index) => `agent-${index}`);

const gone = (name: string) => screen.queryByText(name, { selector: ".name" }) === null;

const removeByKey = (name: string) => {
  fireEvent.click(rowOf(name));
  rowOf(name).focus();
  fireEvent.keyDown(rowOf(name), { key: "Backspace", code: "Backspace", metaKey: true });
};

it("u5991a_every_rail_action_renders_before_its_call_answers", async () => {
  const { app } = await mountRail([agent("first", "done", "finished", { terminal_id: null }), agent("second", "done", "finished", { terminal_id: null })]);
  app.handlers["rail.remove"] = () => new Promise<never>(() => undefined);
  await settled();
  removeByKey("first");
  // The call is still pending, yet the row is already gone and its sibling stays.
  expect(gone("first")).toBe(true);
  expect(rowOf("second")).toBeTruthy();
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "first", operation: expect.any(String) }]));
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("u5991b_ten_removals_and_an_undo_reach_the_daemon_once_in_order", async () => {
  const all = names(10);
  const { app, connected } = await mountRail(all.map(name => agent(name, "done", "finished", { terminal_id: null })));
  const undo = connected.drafts.todoUndo;
  const finish: (() => void)[] = [];

  app.handlers["rail.remove"] = ({ id, operation }) => new Promise(resolve => {
    finish.push(() => resolve({ removed: [], kept: [], deletion: { project: "p", id, operation: operation!, restored: false } }));
  });

  app.handlers["rail.deletion"] = () => null;
  app.handlers["rail.restore"] = ({ project, operation }) => ({ removed: [], kept: [], deletion: { project, id: "x", operation, restored: true } });
  await settled();
  const removals = all.map(name => undo.removeRail(name, name, "rail"));
  const restored = undo.undo("rail");

  for (let index = 0; index < all.length; index++) {
    await waitFor(() => expect(finish).toHaveLength(index + 1));
    // The next call has not been sent while this one is pending.
    expect(railCallsTo(app, "rail.remove")).toHaveLength(index + 1);
    // The undo waits in the queue for every removal's receipt.
    expect(app.calls.filter(call => call.method === "rail.restore")).toHaveLength(0);
    finish[index]!();
  }

  await Promise.all([...removals, restored]);
  // SAFETY: every rail.remove call carries the `id` the handler above reads.
  expect(removedIds(app)).toEqual(all);
  expect(app.calls.filter(call => call.method === "rail.restore")).toHaveLength(1);
});

it.each([["refused", new RpcError(-32003, "Cannot remove: refused")], ["timed out", new Error("Request timed out")], ["gone", new Error("Daemon gone")]] as const)("u5991c_a_failed_call_returns_the_row_with_the_failure_text_%s", async (_name, failure) => {
  const { app } = await mountRail([agent("first", "done", "finished", { terminal_id: null }), agent("second", "done", "finished", { terminal_id: null })]);

  app.handlers["rail.remove"] = () => { throw failure; };

  app.handlers["rail.deletion"] = () => null;
  await settled();
  removeByKey("first");
  await screen.findByText(failure.message);
  expect(rowOf("first")).toBeTruthy();
});

// SAFETY: every rail.remove call in these tests carries the `id` of the row removed.
const removedIds = (app: Awaited<ReturnType<typeof mountRail>>["app"]) => railCallsTo(app, "rail.remove").map(call => (call as { id: string }).id);

const removeWorkstream = async (app: Awaited<ReturnType<typeof mountRail>>["app"], name: string) => {
  fireEvent.contextMenu(rowOf(name));
  await app.pickMenu("Remove");
};

it("u5991c_a_failed_workstream_call_returns_it_with_its_children_and_queued_actions_run_after", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("child", "idle", "idle", { parent: "chosen", terminal_id: null, worktree: null }), agent("other", "done", "finished", { terminal_id: null })]);
  const { promise: queued, resolve: release } = Promise.withResolvers<void>();

  app.handlers["rail.remove"] = async ({ id }) => {
    if (id === "chosen") throw new RpcError(-32003, "Cannot remove: refused");
    await queued;

    return { removed: [], kept: [] };
  };

  app.handlers["rail.deletion"] = () => null;
  await settled();
  await screen.findByText("child", { selector: ".name" });
  await removeWorkstream(app, "chosen");
  await screen.findByText("Cannot remove: refused");
  removeByKey("other");
  expect(rowOf("chosen")).toBeTruthy();
  await screen.findByText("child", { selector: ".name" });
  release();
  await waitFor(() => expect(removedIds(app)).toEqual(["chosen", "other"]));
  expect(gone("other")).toBe(true);
});

it("u5991d_a_loss_question_precedes_the_optimistic_removal", async () => {
  const { app } = await mountRail([workstream("chosen"), agent("running", "working", "busy", { parent: "chosen" })], [info("live-shell", { owner: "chosen" })]);
  await settled();
  await removeWorkstream(app, "chosen");
  await waitFor(() => expect(app.answerRemoval).toBeTypeOf("function"));
  expect(rowOf("chosen")).toBeTruthy();
  expect(rowOf("running")).toBeTruthy();
  app.answerRemoval!("cancel");
  await waitFor(() => expect(document.activeElement).toBe(rowOf("chosen")));
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it("u5991d_a_clean_workstream_leaves_in_the_next_frame_while_its_call_is_pending", async () => {
  const { app } = await mountRail([workstream("chosen"), workstream("child", { parent: "chosen" })]);
  app.handlers["rail.remove"] = () => new Promise<never>(() => undefined);
  await settled();
  await screen.findByText("child", { selector: ".name" });
  await removeWorkstream(app, "chosen");
  await waitFor(() => expect(gone("chosen")).toBe(true));
  expect(gone("child")).toBe(true);
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toHaveLength(1));
});
