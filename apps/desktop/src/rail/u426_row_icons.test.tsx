import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { chooseAction, exitedTerminal, mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

it("u426_arrow_down_skips_icons", async () => {
  await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
  const row = rowOf("g");
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowDown" });
  await settled();
  expect(document.activeElement).toBe(rowOf("a"));
});

it("u426_an_icon_runs_without_selecting_its_row", async () => {
  const mounted = await mountRail([workstream("g"), workstream("h")]);
  mounted.rail.select("g");
  await chooseAction(mounted.app, "h", "Open directory");
  expect(mounted.rail.selected()).toBe("g");
  expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p", line: null }]);
});

it.each(["idle", "working", "needs-you", "blocked"] as const)("u426_stop_preserves_selection_for_%s", async kind => {
  const mounted = await mountRail([workstream("g"), agent("a", kind, "i", { parent: "g" })]);
  mounted.app.handlers["agent.stop"] = () => null;
  mounted.rail.select("g");
  await chooseAction(mounted.app, "a", "Stop");
  expect(mounted.rail.selected()).toBe("g");

  if (kind !== "idle") {
    await questionDialog();
    await answerQuestion(true);
    expect(mounted.rail.selected()).toBe("g");
  }
});

it("u426_a_stopped_agent_offers_no_stop_icon", async () => {
  const { app } = await mountRail([door("m", "done", "done")], [exitedTerminal("m", 0)]);
  fireEvent.contextMenu(rowOf("m"));
  expect(app.menuLabels()).not.toContain("Stop");
});

it("u4455_rail_row_has_no_open_button", async () => {
  const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
  const openButtons = ["a", "g"].flatMap(id => within(rowOf(id)).queryAllByRole("button").filter(b => b.getAttribute("aria-label") === "Open" || b.textContent === "Open"));
  expect(openButtons).toHaveLength(0);
  fireEvent.click(rowOf("a"));
  await settled();
  expect(mounted.rail.selected()).toBe("a");
  rowOf("g").focus();
  fireEvent.keyDown(rowOf("g"), { key: "Enter", code: "Enter" });
  await settled();
  expect(mounted.rail.selected()).toBe("g");
});
