import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { FakeApp } from "../testing/fakeApp";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowNames, rowOf } from "./railFixture";

afterEach(cleanup);

const CMD_BACKSPACE = { key: "Backspace", code: "Backspace", metaKey: true };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fake Daemon whose `rail.remove` takes the row out of the tree it then answers. */
const mount = async (tree: ReturnType<typeof agent>[]) => {
  const mounted = await mountRail(tree);
  mounted.app.handlers["rail.remove"] = () => null;

  return mounted;
};

const removals = (app: FakeApp) => railCallsTo(app, "rail.remove");

describe("u358 cmd backspace removes the selected Rail row", () => {
  it("u358_cmd_backspace_removes_the_selected_idle_agent_and_selects_the_next_row", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x"), agent("b", "idle", "x"), agent("c", "idle", "x")]);
    rail.select("a");
    rowOf("a").focus();

    fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);

    await waitFor(() => expect(rail.selected()).toBe("b"));
    expect(removals(app)).toEqual([{ id: "a" }]);
    expect(document.activeElement).toBe(rowOf("b"));
  });

  it("u358_cmd_backspace_on_a_working_agent_confirms_first_and_escape_cancels", async () => {
    const { app, rail } = await mount([agent("a", "working", "busy"), agent("b", "idle", "x")]);
    rail.select("a");
    rowOf("a").focus();

    fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);
    await tick();

    expect((await questionDialog()).title).toBe("Stop and remove a?");
    expect(removals(app)).toEqual([]);

    await answerQuestion(false);
    await tick();

    expect(questionProbe.shown).toBeNull();
    expect(removals(app)).toEqual([]);

    fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);
    await tick();
    await questionDialog();
    await answerQuestion(true);

    await waitFor(() => expect(removals(app)).toEqual([{ id: "a" }]));
    await waitFor(() => expect(rail.selected()).toBe("b"));
  });

  it("u358_cmd_backspace_on_the_last_row_selects_the_previous_row", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x"), agent("b", "idle", "x")]);
    rail.select("b");
    rowOf("b").focus();

    fireEvent.keyDown(rowOf("b"), CMD_BACKSPACE);

    await waitFor(() => expect(rail.selected()).toBe("a"));
    expect(removals(app)).toEqual([{ id: "b" }]);
  });

  it("u358_cmd_backspace_with_focus_in_the_pane_calls_nothing", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x")]);
    rail.select("a");
    const pane = document.body.appendChild(document.createElement("div"));

    pane.className = "pane";
    const press = new KeyboardEvent("keydown", { ...CMD_BACKSPACE, bubbles: true, cancelable: true });

    pane.dispatchEvent(press);
    await tick();

    expect(removals(app)).toEqual([]);
    expect(press.defaultPrevented).toBe(false);
  });

  it("u358_a_key_repeat_of_cmd_backspace_calls_nothing_more", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x"), agent("b", "idle", "x"), agent("c", "idle", "x")]);
    rail.select("a");
    rowOf("a").focus();

    fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);
    await waitFor(() => expect(rail.selected()).toBe("b"));

    const repeat = new KeyboardEvent("keydown", { ...CMD_BACKSPACE, repeat: true, bubbles: true, cancelable: true });

    rowOf("b").dispatchEvent(repeat);
    await tick();

    expect(removals(app)).toEqual([{ id: "a" }]);
    expect(repeat.defaultPrevented).toBe(true);

    fireEvent.keyDown(rowOf("b"), CMD_BACKSPACE);

    await waitFor(() => expect(removals(app)).toEqual([{ id: "a" }, { id: "b" }]));
  });

  it("u358_a_failed_remove_shows_the_error_line_and_keeps_the_row", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x"), agent("b", "idle", "x")]);
    app.handlers["rail.remove"] = () => {
      throw new Error("daemon said no");
    };

    rail.select("a");
    rowOf("a").focus();

    fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);

    await waitFor(() => expect(screen.getByText(/daemon said no/)).toBeTruthy());
    expect(rail.selected()).toBe("a");
    expect(rowNames()).toContain("a");
  });

  it("u358_other_modifier_sets_remove_nothing", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x")]);
    rail.select("a");

    for (const kept of [{ metaKey: true, shiftKey: true }, { ctrlKey: true }, { altKey: true }, {}])
      fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", ...kept });

    await tick();

    expect(removals(app)).toEqual([]);
  });

  it("u358_cmd_backspace_with_nothing_selected_does_nothing", async () => {
    const { app } = await mount([workstream("g")]);

    fireEvent.keyDown(rowOf("g"), CMD_BACKSPACE);
    await tick();

    expect(removals(app)).toEqual([]);
  });
});
