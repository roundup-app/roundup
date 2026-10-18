import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const icon = (row: string, label: string): HTMLElement | undefined =>
  [...rowOf(row).querySelectorAll<HTMLElement>(".row-icons button")].find((button) => button.getAttribute("aria-label") === label);

const worktree = { path: "/p/.wt/a", branch: "a", base: "main" };

describe("u428 an Agent row's icons", () => {
  it("u428_stop_confirms_a_working_agent_as_the_menu_does", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    app.handlers["agent.stop"] = () => null;

    fireEvent.click(icon("a", "Stop")!);

    expect(screen.getByText("Stop a?")).toBeTruthy();
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop" }));
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
  });

  it("u428_stop_stops_an_idle_agent_at_once", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;

    fireEvent.click(icon("a", "Stop")!);

    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u428_the_icon_and_the_menu_share_one_stop_path", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;

    fireEvent.click(icon("a", "Stop")!);
    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toHaveLength(1));
    fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop" }));

    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }, { id: "a" }]));
  });

  it("u428_no_stop_icon_on_a_stopped_agent", async () => {
    await mountRail([agent("a", "done", "done")], [exitedTerminal("a", 0)]);

    expect(icon("a", "Stop")).toBeUndefined();
    expect(icon("a", "Open folder")).toBeTruthy();
  });

  it("u428_resume_replaces_stop_on_a_resumable_stopped_agent", async () => {
    const { app } = await mountRail([agent("a", "done", "done", { can_resume: true })], [exitedTerminal("a", 0)]);
    app.handlers["agent.resume"] = () => agent("a", "working", "busy");

    expect(icon("a", "Stop")).toBeUndefined();
    fireEvent.click(icon("a", "Resume")!);

    await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a" }]));
  });

  it("u428_open_folder_prefers_the_worktree", async () => {
    const mounted = await mountRail([agent("a", "idle", "i", { worktree })]);

    fireEvent.click(icon("a", "Open folder")!);

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p/.wt/a", line: null }]));
  });

  it("u428_open_folder_falls_back_to_the_project_folder", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);

    fireEvent.click(icon("a", "Open folder")!);

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p", line: null }]));
  });

  it("u428_open_in_editor_sends_the_same_directory", async () => {
    const mounted = await mountRail([agent("a", "idle", "i", { worktree })]);

    fireEvent.click(icon("a", "Open in editor")!);

    await waitFor(() => expect(mounted.app.editorOpened).toEqual(["/p/.wt/a"]));
  });
});
