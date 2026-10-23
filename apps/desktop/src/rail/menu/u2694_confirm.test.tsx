import { mountCentre } from "../../testing/centreFixture";
import { stubDialogLayout } from "../../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { CHORDS, LEADER, RAIL_KEYS } from "../../keys/chords";
import { agent, door, workstream } from "../../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf, settled } from "../railFixture";

afterEach(cleanup);

stubDialogLayout();

const open = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

const removals = (app: Awaited<ReturnType<typeof mountRail>>["app"]) => app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method));

const button = (name: string) => screen.getByRole("button", { name });

const PING = { pong: true as const, pid: 1, project: "/p", projectKey: "p-1", contract: { fingerprint: "", methods: [] } };

describe("u2694 the Rail's menu actions", () => {
  it("u2694a_the_menu_key_opens_the_focused_rows_menu_and_the_pane_keeps_it", async () => {
    const { app } = await mountRail([workstream("g")]);
    rowOf("g").focus();

    fireEvent.keyDown(rowOf("g"), { key: "ContextMenu" });
    await waitFor(() => expect(app.shownMenus).toHaveLength(1));
    await app.closeMenu();
    fireEvent.keyDown(rowOf("g"), { key: "F10", shiftKey: true });
    await waitFor(() => expect(app.shownMenus).toHaveLength(2));
    await app.closeMenu();
    fireEvent.keyDown(document.body, { key: "F10", shiftKey: true });

    expect(app.shownMenus).toHaveLength(2);
  });

  it("u2694a_a_shown_chord_is_the_one_the_webview_binds", async () => {
    const { app } = await mountRail([door("w", "idle", "idle"), agent("a", "working", "busy")]);
    const bound = new Set([...CHORDS.map((chord) => chord.keys), ...RAIL_KEYS, ...LEADER.map((key) => `⌘K ${key.keys}`)]);

    open("w");
    const shown = app.shownMenus.at(-1)!.items.flatMap((item) => (item.shortcut === undefined ? [] : [item.shortcut]));

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((chord) => !bound.has(chord))).toEqual([]);
  });

  it("u2694b_rename_starts_the_in_place_edit_of_each_object", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);

    open("a");
    await app.pickMenu("Rename");

    await waitFor(() => expect(document.activeElement?.tagName).toBe("INPUT"));
  });

  it("u2694b_stop_resume_remove_call_what_they_called_and_confirm_as_before", async () => {
    const { app } = await mountRail([agent("a", "working", "busy"), agent("i", "idle", "idle"), agent("x", "done", "done", { can_resume: true })], [exitedTerminal("x", 0)]);
    app.handlers["agent.stop"] = () => null;
    app.handlers["agent.resume"] = () => agent("x", "idle", "idle");
    app.handlers["rail.remove"] = () => null;

    open("a");
    await app.pickMenu("Remove");
    expect(await screen.findByText("Stop and remove a?")).toBeTruthy();
    expect(removals(app)).toEqual([]);
    fireEvent.click(button("Keep"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(removals(app)).toEqual([]);

    open("a");
    await app.pickMenu("Remove");
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removals(app)).toEqual([{ method: "rail.remove", params: { id: "a" } }]));

    open("i");
    await app.pickMenu("Remove");
    await waitFor(() => expect(removals(app)).toHaveLength(2));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    open("i");
    await app.pickMenu("Stop");
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "i" }]));

    open("x");
    await app.pickMenu("Resume");
    await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "x" }]));
  });

  it.each(["working", "needs-you", "blocked"] as const)("u2694b_stop_confirms_before_stopping_a_%s_agent", async (kind) => {
    const { app } = await mountRail([agent("a", kind, "busy")], [], undefined, () => true);
    app.handlers["agent.stop"] = () => null;

    open("a");
    await app.pickMenu("Stop");
    await screen.findByRole("alertdialog");
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
    fireEvent.click(button("Keep"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(railCallsTo(app, "agent.stop")).toEqual([]);

    open("a");
    await app.pickMenu("Stop");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
  });

  it("u2694b_a_workstream_remove_asks_what_goes_and_esc_keeps", async () => {
    const { app } = await mountRail([workstream("g")]);
    app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });

    open("g");
    await app.pickMenu("Remove");
    await screen.findByText("Goes: Nothing");
    await waitFor(() => expect(document.activeElement).toBe(button("Keep")));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(railCallsTo(app, "rail.remove")).toEqual([]);

    open("g");
    await app.pickMenu("Remove");
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "g" }]));
  });

  it("u2694b_escape_returns_focus_to_the_invoking_row_for_keyboard_navigation", async () => {
    const { app } = await mountCentre([agent("a", "working", "busy"), agent("b", "idle", "idle")], { select: "b" });
    rowOf("a").focus();
    fireEvent.keyDown(rowOf("a"), { key: "ContextMenu" });
    await app.pickMenu("Remove");
    await waitFor(() => expect(document.activeElement).toBe(button("Keep")));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(rowOf("a")));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await settled();

    expect(document.activeElement).toBe(rowOf("b"));
    expect(removals(app)).toEqual([]);
  });

  it("u2694b_a_removed_object_refetches_on_not_found", async () => {
    const { app, rail } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32001, "gone"));
    app.handlers["rail.tree"] = () => [];

    open("a");
    await app.pickMenu("Remove");

    await waitFor(() => expect(rail.nodes).toEqual([]));
    expect(screen.queryByText("gone")).toBeNull();
  });

  it("u2694b_another_remove_error_shows_the_failure_line", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32603, "cannot remove"));

    open("a");
    await app.pickMenu("Remove");

    expect(await screen.findByText("cannot remove")).toBeTruthy();
  });

  it("u2694c_a_failed_send_shows_the_failure_line", async () => {
    const { app } = await mountRail([agent("a", "working", "alpha"), agent("b", "working", "beta")]);
    app.handlers["daemon.ping"] = () => PING;
    app.handlers["message.send"] = () => Promise.reject(new RpcError(-32003, "inbox closed"));

    open("a");
    await app.pickMenu("b");

    expect(await screen.findByText("inbox closed")).toBeTruthy();
  });
});
