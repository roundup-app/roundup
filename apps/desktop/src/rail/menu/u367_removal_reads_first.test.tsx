import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "../railFixture";

afterEach(cleanup);

it("u367_removal_states_what_goes_and_what_stays", async () => {
  const { app } = await mountRail([
    workstream("chosen"),
    agent("running", "working", "busy", { parent: "chosen" }),
    agent("finished", "done", "finished", { parent: "chosen", worktree: { path: "/p/finished", branch: "finished", base: "main" } }),
  ]);

  let read!: () => void;

  const reading = new Promise<void>(resolve => { read = resolve; });

  app.handlers["agent.worktreeState"] = () => reading.then(() => ({ dirty: false, ahead: 0, behind: 0 }));

  const before = railCallsTo(app, "agent.worktreeState").length;

  fireEvent.contextMenu(rowOf("chosen"));
  await app.pickMenu("Remove");
  await waitFor(() => expect(railCallsTo(app, "agent.worktreeState").length).toBeGreaterThan(before));
  expect(app.removalQuestions).toEqual([]);

  read();
  await waitFor(() => expect(app.removalQuestions).toHaveLength(1));
  const [goes, stays] = (app.removalQuestions[0]?.message ?? "").split("\n");
  expect(goes).toContain("finished");
  expect(goes).not.toContain("running");
  expect(stays).toContain("running");
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});
