import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todo } from "../../todos/testHarness";
import { RpcError } from "../../app/seam";
import { agent, door, event, workstream } from "../../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "../railFixture";

afterEach(cleanup);

const open = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

const entry = (app: { shownMenus: { items: { label: string; enabled: boolean; children?: { label: string; enabled: boolean }[] }[] }[] }, label: string) =>
  app.shownMenus.at(-1)!.items.find((item) => item.label === label)!;

describe("u2694 the Rail's system menu", () => {
  it("u2694b_the_items_of_each_object", async () => {
    const { app } = await mountRail([door("w", "idle", "idle"), agent("a", "working", "busy")]);

    open("w");
    expect(app.menuLabels()).toEqual(["Rename", "Restart", "Start YOLO", "Stop", "Resume", "Clear…", "Send to Agent", "Copy Link", "Remove"]);
    expect(entry(app, "Rename")).toMatchObject({ shortcut: "F2" });
    expect(entry(app, "Remove")).toMatchObject({ shortcut: "⌘⌫" });
    open("a");
    expect(app.menuLabels()).toEqual(["Rename", "Restart", "Start YOLO", "Stop", "Resume", "Send to Agent", "Copy Link", "Remove"]);
  });

  it("u2694b_stopping_a_door_calls_agent_stop", async () => {
    const { app } = await mountRail([door("w", "idle", "ready")]);
    app.handlers["agent.stop"] = () => null;

    open("w");
    await app.pickMenu("Stop");

    expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "w" }]);
    expect(railCallsTo(app, "terminal.kill")).toEqual([]);
  });

  it("u2694e_an_agent_owned_pad_opens_its_menu_on_release", async () => {
    const { app } = await mountRail([agent("a", "idle", "ready")], [], undefined, () => true, {}, [{
      incarnation: "notes-1", name: "notes", owner: { kind: "agent", id: "a", parent: null },
      text: "", updated_at: 0, revision: 1, home: null,
    }]);

    fireEvent.click(await screen.findByRole("button", { name: "1 pads" }));

    const pad = await screen.findByRole("button", { name: "notes" });
    const press = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, buttons: 2, clientX: 10, clientY: 10 });

    fireEvent(pad, press);
    expect(press.defaultPrevented).toBe(true);
    expect(app.shownMenus).toHaveLength(0);
    fireEvent.pointerUp(document, { button: 2, clientX: 10, clientY: 10 });

    expect(app.menuLabels()).toEqual(["Send to Agent", "Copy Link", "Delete"]);
    await app.pickMenu("Delete");
    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toContain("notes");
    expect(railCallsTo(app, "pad.delete")).toEqual([]);
    fireEvent.click(within(question).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(railCallsTo(app, "pad.delete")).toEqual([]);
  });

  it("u2694e_an_agent_owned_todo_opens_its_menu_on_release", async () => {
    const { app } = await mountRail([agent("a", "idle", "ready")], [], undefined, () => true);
    app.handlers["todo.list"] = () => [todo(5, { creator: { kind: "agent", id: "a", parent: null } })];
    app.emit(event({ name: "todo.created", data: todo(5, { creator: { kind: "agent", id: "a", parent: null } }) }));
    fireEvent.click(await screen.findByRole("button", { name: "1 todos" }));
    const row = await screen.findByRole("button", { name: /#5 todo 5/ });
    const press = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, buttons: 2, clientX: 10, clientY: 10 });

    fireEvent(row, press);
    expect(press.defaultPrevented).toBe(true);
    expect(app.shownMenus).toHaveLength(0);
    fireEvent.pointerUp(document, { button: 2, clientX: 10, clientY: 10 });
    expect(app.menuLabels()).toEqual(["Complete", "Send to Agent", "Copy Link", "Delete"]);
    app.handlers["todo.complete"] = () => null;
    await app.pickMenu("Complete");
    expect(railCallsTo(app, "todo.complete")).toEqual([{ id: 5 }]);
  });

  it("u2694b_a_group_offers_remove_only", async () => {
    const { app } = await mountRail([workstream("g")]);

    open("g");

    expect(app.menuLabels()).toEqual(["Remove"]);
  });

  it("u2694d_restart_calls_resume_normal_and_start_yolo_calls_resume_yolo", async () => {
    const { app } = await mountRail([agent("a", "working", "busy", { yolo: true })]);
    app.handlers["agent.resume"] = () => agent("a", "working", "busy");

    open("a");
    await app.pickMenu("Restart");
    open("a");
    expect(entry(app, "Start YOLO").enabled).toBe(false);
    await app.closeMenu();

    expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a", mode: "normal" }]);
  });

  it("u2694d_the_item_of_the_current_mode_is_disabled", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);

    open("a");

    expect(entry(app, "Restart").enabled).toBe(false);
    expect(entry(app, "Start YOLO").enabled).toBe(true);
  });

  it("u2694d_a_failed_resume_shows_the_failure_line", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    app.handlers["agent.resume"] = () => { throw new RpcError(-32003, "already running"); };

    open("a");
    await app.pickMenu("Start YOLO");

    await waitFor(() => expect(document.body.textContent).toContain("already running"));
  });

  it("u2694c_send_to_agent_sends_a_note_with_the_link_and_the_read_command", async () => {
    const { app } = await mountRail([agent("a", "working", "busy"), agent("b", "working", "busy"), agent("x", "done", "done")], [exitedTerminal("x", 0)]);
    app.handlers["daemon.ping"] = () => ({ pong: true, pid: 1, project: "/p", projectKey: "p-1", contract: { fingerprint: "", methods: [] } });
    // SAFETY: the Message of the answer is never read by the menu.
    app.handlers["message.send"] = () => ({}) as never;

    open("a");
    expect((app.shownMenus.at(-1)!.items.find((item) => item.label === "Send to Agent")!.children ?? []).map((child) => [child.label, child.enabled]))
      .toEqual([["a", true], ["b", true], ["x", false]]);
    await app.pickMenu("b");

    await waitFor(() => expect(railCallsTo(app, "message.send")).toEqual([
      { to: "b", kind: "note", body: "roundup://agent/a?project=p-1\nrup link read roundup://agent/a?project=p-1", replyTo: null },
    ]));
  });

  it("u2694c_send_to_agent_lists_the_projects_agents_in_rail_order", async () => {
    const { app } = await mountRail([
      door("w", "idle", "ready"),
      agent("a", "working", "busy", { parent: "w" }),
      door("exited", "done", "done", { order: 1 }),
      workstream("group", { order: 2 }),
    ], [exitedTerminal("exited", 0)]);

    open("w");

    expect(entry(app, "Send to Agent").children?.map((child) => [child.label, child.enabled]))
      .toEqual([["w", true], ["a", true], ["exited", false]]);
  });

  it("u2694c_copy_link_writes_the_link", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    app.handlers["daemon.ping"] = () => ({ pong: true, pid: 1, project: "/p", projectKey: "p-1", contract: { fingerprint: "", methods: [] } });

    open("a");
    await app.pickMenu("Copy Link");

    await waitFor(() => expect(write).toHaveBeenCalledWith("roundup://agent/a?project=p-1"));
  });

  it("u2694a_choosing_an_item_runs_its_action_and_null_runs_nothing", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;

    open("a");
    await app.closeMenu();
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
    open("a");
    await app.pickMenu("Stop");

    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
  });
});
