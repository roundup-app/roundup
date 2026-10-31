import { questionDialog, answerQuestion } from "../../shelf/bulkQuestionHarness";
import { questionProbe } from "../../testing/menuProbe";
import { mountCentre } from "../../testing/centreFixture";
import { stubDialogLayout } from "../../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { CHORDS, LEADER, RAIL_KEYS } from "../../keys/chords";
import { agent, door, info, terminal, workstream } from "../../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "../railFixture";

import { createFakeApp } from "../../testing/fakeApp";
import { goesLine, staysLine, judgeRemoval } from "./removal";
import { padOf } from "../../pads/padsFixture";
import { todo } from "../../todos/testHarness";

afterEach(cleanup);

stubDialogLayout();

const open = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

const removals = (app: Awaited<ReturnType<typeof mountRail>>["app"]) => app.calls.filter((call) => ["agent.stop", "rail.remove"].includes(call.method));



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

  it.each([
    [agent("chosen", "working", "busy"), []],
    [agent("chosen", "idle", "idle"), []],
    [terminal("chosen"), []],
  ])("u3787a_live_rail_removal_waits_for_native_consent_%j", async (node, terminals) => {
    const { app } = await mountRail([node], terminals);
    app.handlers["rail.remove"] = () => null;
    open("chosen");
    await app.pickMenu("Remove");
    expect(app.questions).toHaveLength(1);
    expect(app.questions[0]!.title).toContain("chosen");
    expect(removals(app)).toEqual([]);
    await answerQuestion(false);
    expect(removals(app)).toEqual([]);
    open("chosen");
    await app.pickMenu("Remove");
    await answerQuestion(true);
    await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "chosen" }]));
  });

  it.each(["working", "needs-you", "blocked"] as const)("u2694b_stop_confirms_before_stopping_a_%s_agent", async (kind) => {
    const { app } = await mountRail([agent("a", kind, "busy")], [], undefined, () => true);
    app.handlers["agent.stop"] = () => null;

    open("a");
    await app.pickMenu("Stop");
    await questionDialog();
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
    await questionDialog();
    await answerQuestion(false);
    await waitFor(() => expect(questionProbe.shown).toBeNull());
    expect(railCallsTo(app, "agent.stop")).toEqual([]);

    open("a");
    await app.pickMenu("Stop");
    await questionDialog();
    await answerQuestion(true);
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
  });

  it("u2694b_a_workstream_worktree_remove_asks_what_goes_and_esc_keeps", async () => {
    const { app } = await mountRail([workstream("g", { worktree: { path: "/p/tree", branch: "work", base: "main" } })]);
    app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });

    open("g");
    await app.pickMenu("Remove");
    expect(await questionDialog()).toMatchObject({ okLabel: "Remove", cancelLabel: "Keep" });
    await questionDialog();
    await answerQuestion(false);
    await waitFor(() => expect(questionProbe.shown).toBeNull());
    expect(railCallsTo(app, "rail.remove")).toEqual([]);

    open("g");
    await app.pickMenu("Remove");
    await questionDialog();
    await answerQuestion(true);

    await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "g" }]));
  });

  it("u2694b_escape_returns_focus_to_the_invoking_row_for_keyboard_navigation", async () => {
    const { app } = await mountCentre([agent("a", "working", "busy"), agent("b", "idle", "idle")], { select: "b" });
    rowOf("a").focus();
    fireEvent.keyDown(rowOf("a"), { key: "ContextMenu" });
    await app.pickMenu("Remove");
    await questionDialog();

    await answerQuestion(false);
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
    await answerQuestion(true);

    await waitFor(() => expect(rail.nodes).toEqual([]));
    expect(screen.queryByText("gone")).toBeNull();
  });

  it("u5172b_refused_remove_shows_the_failure_line", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32003, "cannot remove"));

    open("a");
    await app.pickMenu("Remove");
    await answerQuestion(true);

    expect(await screen.findByRole("alert")).toBeDefined();
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


it.each([
  workstream("group", { parent: "chosen", status: null }),
  workstream("group", { parent: "chosen", worktree: { path: "/p/group", branch: "group", base: "main" } }),
  door("supervisor", "working", "busy", { parent: "chosen" }),
  door("supervisor", "done", "finished", { parent: "chosen", worktree: { path: "/p/door", branch: "door", base: "main" } }),
])("u4368_only_agent_nodes_enter_goes_and_stays_%j", async container => {
  const app = createFakeApp();
  const result = await judgeRemoval(app, [workstream("chosen"), container], "chosen");

  expect(result.removedIds).toEqual([container.id]);
  expect(result.goes).toEqual({ agents: [], todos: 0, pads: 0 });
  expect(result.stays).toEqual({ agents: [], todos: 0, pads: 0 });
  expect(railCallsTo(app, "agent.worktreeState")).toEqual([]);
});

it("u4368_nested_agents_keep_a34_classification", async () => {
  const app = createFakeApp();
  app.handlers["todo.list"] = () => [todo(1, { home: "chosen", done: true }), todo(2, { home: "chosen" })];
  app.handlers["pad.list"] = () => [
    { ...padOf("finished notes", { kind: "agent", id: "finished", parent: null }), home: "chosen" },
    { ...padOf("running notes", { kind: "agent", id: "running", parent: null }), home: "chosen" },
  ];

  const result = await judgeRemoval(app, [
    workstream("chosen"),
    workstream("group", { parent: "chosen", status: null }),
    agent("finished", "done", "finished", { parent: "group", worktree: { path: "/p/finished", branch: "finished", base: "main" } }),
    door("supervisor", "working", "busy", { parent: "group" }),
    agent("running", "working", "busy", { parent: "supervisor" }),
  ], "chosen");

  expect(result.goes).toEqual({ agents: ["finished"], todos: 1, pads: 2 });
  expect(result.stays).toEqual({ agents: [{ name: "running", reason: "Running" }], todos: 1, pads: 0 });
  expect(railCallsTo(app, "agent.worktreeState")).toEqual([{ id: "finished" }]);
  expect([goesLine(result, "chosen"), staysLine(result)]).toEqual([
    "Goes: chosen, finished, 1 done Todo, 2 Pads",
    "Stays: running, 1 open Todo",
  ]);
});

it.each(["chosen", "group", "supervisor"])("u4368_container_terminal_loss_still_requires_consent_%s", async owner => {
  const { app } = await mountRail([
    workstream("chosen"),
    workstream("group", { parent: "chosen", status: null }),
    door("supervisor", "done", "finished", { parent: "group", terminal_id: null }),
  ], [info("live-shell", { owner })]);

  app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });

  open("chosen");
  await app.pickMenu("Remove");
  const question = await questionDialog();
  expect(question).toMatchObject({ okLabel: "Remove", cancelLabel: "Keep" });
  expect(removals(app)).toEqual([]);
  await answerQuestion(false);
  await waitFor(() => expect(questionProbe.shown).toBeNull());
  expect(removals(app)).toEqual([]);

  open("chosen");
  await app.pickMenu("Remove");
  await questionDialog();
  await answerQuestion(true);
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "chosen" }]));
});
