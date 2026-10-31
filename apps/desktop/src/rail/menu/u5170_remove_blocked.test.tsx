import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { copy } from "../../todos/copy";
import { agent, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "../railFixture";
import { createRoot } from "solid-js";
import type { AppSeam } from "../../app/seam";
import { createFakeApp } from "../../testing/fakeApp";
import { createTodoUndo } from "../../todos/deleteTodos";

/** A todoUndo on a stub App: `lose` makes rail.remove's acknowledgement vanish; `hold` leaves it unanswered. */
const harness = (initial: "idle" | "lose" | "hold" | "offline") => {
  let mode = initial;
  const calls: string[] = [];
  let release: () => void = () => undefined;

  const rpc = async (method: string): Promise<object | null> => {
    calls.push(method);

    if (method === "daemon.ping") return { projectKey: "p" };

    if (method === "rail.deletion") return null;

    if (method === "rail.remove") {
      if (mode === "lose") throw new Error("link lost");

      if (mode === "hold") await new Promise<never>((_, reject) => { release = () => reject(new Error("released")); });

      return { deletion: { operation: "o", project: "p", restored: false } };
    }

    return null;
  };

  // SAFETY: the todoUndo under test calls only `rpc`, and each method it sends answers with one of the shapes above.
  const app: AppSeam = { ...createFakeApp(), rpc: rpc as AppSeam["rpc"] };

  const undo = createRoot(() => createTodoUndo());

  if (mode !== "offline") undo.reconnect(app);

  return { undo, calls, lose: () => { mode = "lose"; }, release: () => release(), removes: () => calls.filter(m => m === "rail.remove").length };
};

it("u5170a_remove_renamed_workstream_sends_rail_remove", async () => {
  const { undo, removes } = harness("idle");
  expect(await undo.removeRail("w", "Design feedback and doodles", "rail")).toBe(true);
  expect(removes()).toBe(1);
});

it.each(["hold", "lose", "offline"] as const)("u5170a_blocked_remove_says_what_blocks_it_%s", async mode => {
  const { undo, removes, release } = harness(mode);
  const first = undo.removeRail("a", "First", "rail");
  await Promise.resolve();
  expect(await undo.removeRail("b", "Second", "rail")).toBe(false);
  const message = undo.feedbackFailure();
  expect(message).toBeTruthy();
  expect(removes()).toBe(mode === "offline" ? 0 : 1);

  if (mode === "hold") release();
  await first;
});

it("u5170b_retry_or_dismiss_unblocks_remove", async () => {
  const { undo, removes } = harness("lose");
  await undo.removeRail("a", "First", "rail");
  expect(undo.uncertain()).toBe(true);
  await undo.removeRail("b", "Second", "rail");
  expect(undo.feedbackFailure()).toContain("First");
  undo.dismiss();
  expect(undo.uncertain()).toBe(false);
  expect(undo.feedbackFailure()).toContain("is still unconfirmed");
  const before = removes();
  await undo.removeRail("b", "Second", "rail");
  expect(removes()).toBe(before + 1);
});

it.each(["todos", "pads", "undo"] as const)("u5170c_gated_actions_never_return_silently_%s", async action => {
  const { undo, calls, lose } = harness("idle");
  // One finished Remove gives Undo something to act on; then a lost acknowledgement blocks everything.
  await undo.removeRail("done", "Done", "rail");
  lose();
  await undo.removeRail("a", "First", "rail");
  const before = calls.length;

  if (action === "todos") await undo.removeTodos([1], "todos");
  else if (action === "pads") await undo.removePads([{ name: "n", incarnation: "i" }], "pads");
  else await undo.undo();

  expect(calls.length).toBe(before);
  expect(undo.feedbackFailure()).toContain("First");
});

const states = ["unconfirmed_todo", "unconfirmed_redo", "pad_pending", "todo_in_flight", "pad_in_flight"] as const;

describe("u5170d", () => {
  afterEach(cleanup);

  it.each(states.flatMap(state => (["menu", "shortcut"] as const).map(entry => [state, entry] as const)))("u5170d_menu_and_shortcut_remove_blocked_%s_%s", async (state, entry) => {
    const title = "Design feedback and doodles";
    const { app, connected } = await mountRail([workstream("w", { name: title }), agent("a", "done", "finished", { parent: "w", terminal_id: null })]);
    const history = connected.drafts.todoUndo;
    const lost = () => { throw new Error("link lost"); };

    const held = () => new Promise<never>(() => undefined);

    const receipt = (params: { operation: string; ids: number[] }) => ({ operation: params.operation, deleted: params.ids, missing: [], state: "deleted" as const });

    app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });

    if (state === "unconfirmed_todo" || state === "todo_in_flight") {
      app.handlers["todo.deletion"] = lost;
      app.handlers["todo.delete"] = state === "todo_in_flight" ? held : lost;
      const seeded = history.removeTodos([1], "todos");

      if (state === "unconfirmed_todo") await seeded;
    } else if (state === "unconfirmed_redo") {
      app.handlers["todo.delete"] = receipt;
      app.handlers["todo.deletion"] = () => null;
      app.handlers["todo.restore"] = ({ operation }) => ({ operation, deleted: [1], missing: [], state: "restored", restoration: "r" });
      app.handlers["todo.redo"] = lost;
      await history.removeTodos([1], "todos");
      await history.undo();
      app.handlers["todo.deletion"] = lost;
      await history.redo();
    } else {
      app.handlers["pad.getDeletion"] = lost;
      app.handlers["pad.delete"] = state === "pad_in_flight" ? held : lost;
      const seeded = history.removePads([{ name: "notes", incarnation: "i" }], "pads");

      if (state === "pad_pending") await seeded;
    }

    await settled();

    fireEvent.click(rowOf(title));
    await settled();

    if (entry === "menu") {
      fireEvent.contextMenu(rowOf(title));
      await app.pickMenu("Remove");
    } else {
      rowOf(title).focus();
      fireEvent.keyDown(rowOf(title), { key: "Backspace", code: "Backspace", metaKey: true });
    }

    const inFlight = state.endsWith("in_flight");
    await waitFor(() => expect(history.feedbackFailure()).toEqual(inFlight ? copy.deleteBusy : expect.stringContaining("Check deletion")));
    expect(railCallsTo(app, "rail.remove")).toEqual([]);
  });
});
