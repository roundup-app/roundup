import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, door } from "../testing/nodes";
import { exitedTerminal, chooseAction, mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);



const worktree = { path: "/p/.wt/a", branch: "a", base: "main" };

describe("u428 an Agent row's icons", () => {
  it("u428_stop_confirms_a_working_agent_as_the_menu_does", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    app.handlers["agent.stop"] = () => null;

    fireEvent.click(within(rowOf("a")).getByRole("button", { name: "Stop" }));

    expect((await questionDialog()).title).toBe("Stop a?");
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
    await questionDialog();
    await answerQuestion(true);
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
  });

  it("u428_stop_stops_an_idle_agent_at_once", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;

    fireEvent.click(within(rowOf("a")).getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
    expect(questionProbe.shown).toBeNull();
  });

  it("u428_the_icon_and_the_menu_share_one_stop_path", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle"), agent("b", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;

    // U5991a: a stopped row is drawn stopped at once, so the menu path takes the other row.
    fireEvent.click(within(rowOf("a")).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toHaveLength(1));
    fireEvent.contextMenu(rowOf("b"), { clientX: 1, clientY: 1 });
    await app.pickMenu("Stop");

    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }, { id: "b" }]));
  });

  it("u428_no_stop_icon_on_a_stopped_agent", async () => {
    const { app } = await mountRail([agent("a", "done", "done")], [exitedTerminal("a", 0)]);

    fireEvent.contextMenu(rowOf("a"));
    expect(app.menuLabels()).not.toContain("Stop");
    expect(app.menuLabels()).toContain("Open directory");
  });

  it("u428_resume_replaces_stop_on_a_resumable_stopped_agent", async () => {
    const { app } = await mountRail([agent("a", "done", "done", { can_resume: true })], [exitedTerminal("a", 0)]);
    app.handlers["agent.resume"] = () => agent("a", "working", "busy");

    fireEvent.contextMenu(rowOf("a"));
    expect(app.menuLabels()).not.toContain("Stop");
    await app.closeMenu();
    fireEvent.click(within(rowOf("a")).getByRole("button", { name: "Resume" }));

    await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a" }]));
  });

  it("u428_open_folder_prefers_the_worktree", async () => {
    const mounted = await mountRail([agent("a", "idle", "i", { worktree })]);

    await chooseAction(mounted.app, "a", "Open directory");

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p/.wt/a", line: null }]));
  });

  it("u428_open_folder_falls_back_to_the_project_folder", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);

    await chooseAction(mounted.app, "a", "Open directory");

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p", line: null }]));
  });

  it.each([agent, door].flatMap(make => [null, worktree].map(worktree => make("a", "idle", "i", { worktree }))))("u428_open_in_editor_sends_the_same_directory_$kind/$worktree", async node => {
    const mounted = await mountRail([node]);

    await chooseAction(mounted.app, "a", "Open in editor");

    await waitFor(() => expect(mounted.app.editorOpened).toEqual([node.worktree ? "/p/.wt/a" : "/p"]));
  });
});

it.each([agent("a", "idle", "ready"), door("a", "idle", "ready")])("u428_folder_and_editor_are_menu_only_$kind", async node => {
  const { app } = await mountRail([node]);

  for (const label of ["Open directory", "Open in editor"]) {
    expect(within(rowOf("a")).queryByRole("button", { name: label })).toBeNull();
  }

  fireEvent.contextMenu(rowOf("a"));
  expect(app.menuLabels()).toEqual(expect.arrayContaining(["Open directory", "Open in editor"]));
});
