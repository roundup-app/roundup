import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent } from "../../testing/nodes";
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
  expect(railCallsTo(app, "rail.remove").map(call => (call as { id: string }).id)).toEqual(all);
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
