import { RpcError } from "../app/seam";
import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { menuProbe, questionProbe } from "../testing/menuProbe";
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
    await answerQuestion(true);

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
    await answerQuestion(true);

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
    await answerQuestion(true);
    await waitFor(() => expect(rail.selected()).toBe("b"));

    const repeat = new KeyboardEvent("keydown", { ...CMD_BACKSPACE, repeat: true, bubbles: true, cancelable: true });

    rowOf("b").dispatchEvent(repeat);
    await tick();

    expect(removals(app)).toEqual([{ id: "a" }]);
    expect(repeat.defaultPrevented).toBe(true);

    fireEvent.keyDown(rowOf("b"), CMD_BACKSPACE);
    await answerQuestion(true);

    await waitFor(() => expect(removals(app)).toEqual([{ id: "a" }, { id: "b" }]));
  });

  it("u358_a_failed_remove_shows_the_error_line_and_keeps_the_row", async () => {
    const { app, rail } = await mount([agent("a", "idle", "x"), agent("b", "idle", "x")]);
    app.handlers["rail.remove"] = () => {
      throw new RpcError(-32003, "daemon said no");
    };

    rail.select("a");
    rowOf("a").focus();

    fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);
    await answerQuestion(true);

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

  /** U2694g's right-button sequence, then the native menu dismissed. */
  const contextClickAndDismiss = async (id: string) => {
    const target = rowOf(id);
    const event = (type: string, buttons: number) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 2, buttons, clientX: 10, clientY: 10 }));

    event("pointerdown", 2);
    event("mousedown", 2);
    event("contextmenu", 2);
    event("pointerup", 0);
    event("mouseup", 0);
    await waitFor(() => expect(menuProbe.answer).not.toBeNull());
    menuProbe.answer!(null);
    await tick();
  };

  const dismissedMenu = async () => {
    const mounted = await mount([agent("a", "idle", "x"), agent("b", "idle", "x"), agent("c", "idle", "x")]);

    mounted.rail.select("a");
    rowOf("a").focus();
    menuProbe.count = 0;
    menuProbe.answer = null;
    await contextClickAndDismiss("b");

    return mounted;
  };

  it("u5951a_dismissed_menu_keeps_its_row_selected_and_focused", async () => {
    const { app } = await dismissedMenu();

    expect(menuProbe.count).toBe(1);
    expect(rowOf("b").getAttribute("aria-selected") ?? rowOf("b").closest("[role=treeitem]")?.getAttribute("aria-selected")).toBe("true");
    expect(rowOf("a").closest("[role=treeitem]")?.getAttribute("aria-selected")).not.toBe("true");
    expect(document.activeElement).toBe(rowOf("b"));
    expect(app.calls.filter(call => /^(rail\.remove|terminal\.(open|write)|agent\.(spawn|resume))$/.test(call.method))).toEqual([]);
    expect(questionProbe.count).toBe(0);
  });

  it("u5951a_removal_after_menu_dismissal_selects_and_focuses_next_row", async () => {
    const { app, rail } = await dismissedMenu();

    fireEvent.keyDown(document.activeElement!, CMD_BACKSPACE);
    await answerQuestion(true);

    await waitFor(() => expect(removals(app)).toEqual([{ id: "b" }]));
    await waitFor(() => expect(rail.selected()).toBe("c"));
    expect(document.activeElement).toBe(rowOf("c"));
    expect(rowOf("c").closest("[role=treeitem]")?.getAttribute("aria-selected")).toBe("true");
  });
});
