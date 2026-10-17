import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, workstream, door } from "../../testing/nodes";
import { exitedTerminal, mountRail, rowOf, settled } from "../railFixture";

afterEach(cleanup);

const openAt = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

const item = (name: string) => screen.getByRole("menuitem", { name });

/** A Workstream's `remove` asks first (U367): choose it, wait for the judgement, choose it again. */
const confirmRemove = async () => {
  fireEvent.click(item("Remove"));
  await screen.findByText(/^Goes: /);
  fireEvent.click(item("Remove"));
};

describe("u56 remove from the Rail", () => {
  it("u56_right_click_selects_the_row_and_opens_a_menu_at_the_pointer", async () => {
    const { rail } = await mountRail([workstream("g")]);

    openAt("g");

    expect(rail.selected()).toBe("g");
    expect(screen.getByRole("menu").getAttribute("style")).toContain("120px");
    expect(item("Remove")).toBeTruthy();
  });

  it("u56_a_running_agent_offers_stop_and_remove", async () => {
    await mountRail([agent("a", "working", "busy")]);

    openAt("a");

    expect(screen.getAllByRole("menuitem").map((each) => each.textContent)).toEqual(["Stop", "Remove"]);
  });

  it("u56_a_done_door_offers_remove_and_clear_only", async () => {
    await mountRail([door("m", "done", "done")], [exitedTerminal("m", 0)]);

    openAt("m");
    expect(screen.getAllByRole("menuitem").map((each) => each.textContent)).toEqual(["Remove", "Clear…"]);
  });

  it("u56_stop_calls_agent_stop_for_an_agent", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    app.handlers["agent.stop"] = () => null;
    openAt("a");

    fireEvent.click(item("Stop"));

    expect(app.calls.filter((call) => call.method === "agent.stop").map((call) => call.params)).toEqual([{ id: "a" }]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u56_removing_a_group_calls_rail_remove_without_stopping_children", async () => {
    const { app } = await mountRail([workstream("g"), agent("child", "working", "busy", { parent: "g" })]);
    app.handlers["rail.remove"] = () => null;
    openAt("g");

    await confirmRemove();

    await waitFor(() => expect(app.calls.some((call) => call.method === "rail.remove")).toBe(true));
    expect(app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method))).toEqual([
      { method: "rail.remove", params: { id: "g" } },
    ]);
  });

  it("u56_a_working_agent_asks_before_backend_checked_removal", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    app.handlers["agent.stop"] = () => null;
    app.handlers["rail.remove"] = () => null;
    openAt("a");

    fireEvent.click(item("Remove"));

    expect(screen.getByText("Stop and remove a?")).toBeTruthy();
    expect(app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method))).toEqual([]);

    fireEvent.click(item("Remove"));
    await waitFor(() => expect(app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method))).toEqual([
      { method: "rail.remove", params: { id: "a" } },
    ]));
  });

  it("u56_keep_cancels_a_confirmed_removal", async () => {
    const { app } = await mountRail([agent("a", "needs-you", "asks")]);
    openAt("a");
    fireEvent.click(item("Remove"));

    fireEvent.click(item("Keep"));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(app.calls.filter((call) => call.method === "rail.remove")).toEqual([]);
  });

  it("u56_idle_agent_removal_goes_at_once_to_the_backend", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;
    app.handlers["rail.remove"] = () => null;
    openAt("a");

    fireEvent.click(item("Remove"));

    await waitFor(() => expect(app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method))).toEqual([
      { method: "rail.remove", params: { id: "a" } },
    ]));
  });

  it("u56_context_menu_key_opens_under_the_focused_row_and_esc_closes_it", async () => {
    await mountRail([workstream("g")]);
    rowOf("g").focus();

    fireEvent.keyDown(rowOf("g"), { key: "ContextMenu" });

    expect(screen.getByRole("menu")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(item("Remove")));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await settled();
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(rowOf("g")));
  });

  it("u56_shift_f10_in_the_rail_opens_the_menu", async () => {
    await mountRail([workstream("g")]);
    rowOf("g").focus();

    fireEvent.keyDown(rowOf("g"), { key: "F10", shiftKey: true });

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("u56_a_pointer_down_outside_the_menu_closes_it", async () => {
    await mountRail([workstream("g")]);
    openAt("g");

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u56_shift_f10_in_the_pane_does_not_open_a_rail_menu", async () => {
    await mountRail([workstream("g")]);

    fireEvent.keyDown(document.body, { key: "F10", shiftKey: true });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u56_down_moves_to_remove_and_enter_chooses_it", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;
    app.handlers["rail.remove"] = () => null;
    openAt("a");
    await waitFor(() => expect(document.activeElement).toBe(item("Stop")));

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });

    await waitFor(() => expect(app.calls.some((call) => call.method === "rail.remove")).toBe(true));
  });

  it("u56_not_found_refetches_rail_tree_and_does_not_show_an_error", async () => {
    const { app, rail } = await mountRail([workstream("g")]);
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32001, "gone"));
    app.handlers["rail.tree"] = () => [];
    openAt("g");

    await confirmRemove();

    await waitFor(() => expect(rail.nodes).toEqual([]));
    expect(screen.queryByText("gone")).toBeNull();
  });

  it("u56_unlanded_workstream_removal_leaves_the_live_door_running", async () => {
    const { app, rail } = await mountRail([door("r", "working", "busy")]);
    app.handlers["agent.stop"] = () => null;
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32003, "worktree_unlanded: dirty 1, ahead 0"));
    openAt("r");
    await confirmRemove();

    await screen.findByText("worktree_unlanded: dirty 1, ahead 0");
    expect(app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method))).toEqual([
      { method: "rail.remove", params: { id: "r" } },
    ]);
    expect(rail.nodes[0]?.terminal_id).toBe("t-r");
  });

  it("u56_other_remove_error_uses_the_rail_failure_line", async () => {
    const { app } = await mountRail([workstream("g")]);
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32603, "cannot remove"));
    openAt("g");

    await confirmRemove();

    expect(await screen.findByText("cannot remove")).toBeTruthy();
  });
});
