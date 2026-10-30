import { expect, it } from "vitest";
import { createRoot } from "solid-js";
import type { AppSeam } from "../../app/seam";
import { createTodoUndo } from "../../todos/deleteTodos";

type CallParams = Record<string, unknown>;

type Call = [string, CallParams];

/** A todoUndo on a stub App: `lose` makes rail.remove's acknowledgement vanish; `hold` leaves it unanswered. */
const harness = (initial: "idle" | "lose" | "hold" | "offline") => {
  let mode = initial;
  const calls: Call[] = [];
  let release: () => void = () => undefined;

  // SAFETY: the todoUndo under test calls only `rpc`; every other App member is unreached here.
  const app = {
    rpc: (method: string, params: CallParams) => {
      calls.push([method, params]);

      if (method === "daemon.ping") return Promise.resolve({ projectKey: "p" });

      if (method === "rail.deletion") return Promise.resolve(null);

      if (method === "rail.remove") {
        if (mode === "lose") return Promise.reject(new Error("link lost"));

        if (mode === "hold") return new Promise<never>((_, reject) => { release = () => reject(new Error("released")); });

        return Promise.resolve({ deletion: { operation: "o", project: "p", restored: false } });
      }

      return Promise.resolve(null);
    },
  } as unknown as AppSeam;

  const undo = createRoot(() => createTodoUndo());

  if (mode !== "offline") undo.reconnect(app);

  return { undo, calls, lose: () => { mode = "lose"; }, release: () => release(), removes: () => calls.filter(([m]) => m === "rail.remove").length };
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
