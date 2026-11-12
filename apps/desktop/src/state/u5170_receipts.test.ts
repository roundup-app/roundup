import { createRoot } from "solid-js";
import { expect, it } from "vitest";
import type { AppSeam } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { createTodoUndo } from "./undo";

/** A todoUndo on a stub App; `answer` replaces one method's reply, and every call is logged in order. */
const harness = () => {
  const calls: string[] = [];
  const answers = new Map<string, (params: unknown) => unknown>();

  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    calls.push(method);
    const answer = answers.get(method);

    if (answer) return answer(params);

    switch (method) {
      case "daemon.ping": return { projectKey: "p" };
      case "todo.delete": return { operation: (params as { operation: string }).operation, deleted: [1], missing: [], state: "deleted" };
      case "rail.remove": return { deletion: { operation: "o", project: "p", restored: false } };
      default: return null;
    }
  };

  // SAFETY: the todoUndo under test sends only the methods answered above or by `answer`.
  const app: AppSeam = { ...createFakeApp(), rpc: rpc as AppSeam["rpc"] };
  const undo = createRoot(() => createTodoUndo());
  undo.reconnect(app);

  return { undo, calls, answer: (method: string, reply: (params: unknown) => unknown) => { answers.set(method, reply); } };
};

const restored = (params: unknown) => ({ operation: (params as { operation: string }).operation, deleted: [1], missing: [], state: "restored", restoration: "r" });

it("u5170c_a_lost_acknowledgement_never_applies_twice", async () => {
  const { undo, calls, answer } = harness();
  await undo.removeTodos([1], "todos");
  // The earlier restore's reply was lost, so the Daemon already holds the restoration.
  answer("todo.deletion", restored);
  await undo.undo("todos");
  expect(calls).not.toContain("todo.restore");
  expect(undo.redoLabel("todos")).not.toBe("Redo");
  const sent = calls.length;
  await undo.undo("todos");
  expect(calls.length).toBe(sent);
});

it("u5170b_a_retry_of_the_same_unconfirmed_work_passes_the_gate", async () => {
  const { undo, calls, answer } = harness();
  answer("rail.remove", () => { throw new Error("link lost"); });
  await undo.removeRail("a", "First", "rail");
  expect(undo.uncertain()).toBe(true);
  const sent = calls.length;

  expect(await undo.removeRail("b", "Second", "rail")).toBe(false);
  expect(calls.length).toBe(sent);
  expect(undo.feedbackFailure()).toContain("First");

  answer("rail.remove", () => ({ deletion: { operation: "o", project: "p", restored: false } }));
  expect(await undo.removeRail("a", "First", "rail")).toBe(true);
  expect(undo.uncertain()).toBe(false);
});

it("u5991b_undo_started_during_a_remove_runs_after_it", async () => {
  const { undo, calls, answer } = harness();
  await undo.removeRail("done", "Done", "rail");
  answer("rail.restore", () => ({ deletion: { operation: "o", project: "p", restored: true } }));
  let release: () => void = () => undefined;
  answer("rail.remove", () => new Promise(resolve => { release = () => resolve({ deletion: { operation: "o2", project: "p", restored: false } }); }));
  const removing = undo.removeRail("next", "Next", "rail");
  const undoing = undo.undo("rail");
  await Promise.resolve();
  expect(calls).not.toContain("rail.restore");
  release();
  await Promise.all([removing, undoing]);
  expect(calls.indexOf("rail.restore")).toBeGreaterThan(calls.lastIndexOf("rail.remove"));

  // An idle call starts in the same tick.
  const before = calls.length;
  void undo.undo("rail");
  expect(calls.length).toBeGreaterThan(before);
});

it("u5170a_the_rail_row_lifts_even_when_the_combinator_throws", async () => {
  const { undo, answer } = harness();
  const lifted: boolean[] = [];
  undo.bindRail(() => async kept => { lifted.push(kept); });
  await undo.removeRail("a", "First", "rail");
  answer("rail.restore", () => { throw new Error("link lost"); });
  await undo.undo("rail");
  expect(lifted).toEqual([false]);
  expect(undo.feedbackFailure()).toContain("link lost");
});
