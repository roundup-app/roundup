import { answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { copy } from "./copy";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

it("u428_stop_asks_first_for_working_needs_you_and_blocked_agents", async () => {
  const { app } = await mountRail([agent("w", "working", "busy"), agent("n", "needs-you", "busy"), agent("b", "blocked", "busy")]);
  app.handlers["agent.stop"] = () => null;
  const stopped: { id: string }[] = [];

  for (const id of ["w", "n", "b"]) {
    fireEvent.click(within(rowOf(id)).getByRole("button", { name: "Stop" }));
    await questionDialog();
    expect(railCallsTo(app, "agent.stop")).toEqual(stopped);
    await answerQuestion(false);
    await waitFor(() => expect(questionProbe.shown).toBeNull());
    expect(railCallsTo(app, "agent.stop")).toEqual(stopped);

    fireEvent.click(within(rowOf(id)).getByRole("button", { name: "Stop" }));
    await questionDialog();
    await answerQuestion(true);
    stopped.push({ id });
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual(stopped));
  }
});

it("u428_a_dialog_remount_still_returns_focus_to_the_row", async () => {
  const tree = [workstream("w"), agent("b", "idle", "idle", { can_save_as_mode: true })];
  const { app, rail } = await mountRail(tree);
  fireEvent.contextMenu(rowOf("b"), { clientX: 1, clientY: 1 });
  await app.pickMenu(copy.saveAsMode);
  const field = await screen.findByRole("textbox", { name: copy.name });

  // The row remounts under its Workstream while the dialog is open, so the element that opened it is gone and only `finalFocus` finds the row.
  tree[1] = agent("b", "idle", "idle", { can_save_as_mode: true, parent: "w" });
  await rail.refresh();
  fireEvent.keyDown(field, { key: "Escape" });

  await waitFor(() => expect(document.activeElement).toBe(rowOf("b")));
});
