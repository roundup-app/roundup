import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { agent } from "../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const icon = (row: string, label: string): HTMLElement | null => rowOf(row).querySelector<HTMLElement>(`.rail-icons [aria-label="${label}"]`);

const stops = (app: Awaited<ReturnType<typeof mountRail>>["app"]) => railCallsTo(app, "agent.stop");

describe("u428 an Agent row's icons", () => {
  it("u428_stop_confirms_a_working_agent_as_the_menu_does", async () => {
    for (const kind of ["working", "needs-you", "blocked"] satisfies Kind[]) {
      const mounted = await mountRail([agent("a", kind, "x")]);
      mounted.app.handlers["agent.stop"] = () => null;

      fireEvent.click(icon("a", "stop")!);
      expect(screen.getByText("stop a?")).toBeTruthy();
      expect(stops(mounted.app)).toEqual([]);

      fireEvent.click(screen.getByRole("menuitem", { name: "stop" }));
      await waitFor(() => expect(stops(mounted.app)).toEqual([{ id: "a" }]));
      cleanup();
    }
  });

  it("u428_stop_stops_an_idle_agent_at_once", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);
    mounted.app.handlers["agent.stop"] = () => null;

    fireEvent.click(icon("a", "stop")!);

    await waitFor(() => expect(stops(mounted.app)).toEqual([{ id: "a" }]));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u428_the_icon_and_the_menu_share_one_stop_path", async () => {
    const mounted = await mountRail([agent("a", "working", "busy"), agent("b", "working", "busy")]);
    mounted.app.handlers["agent.stop"] = () => null;

    // The menu's `stop` asks the same question as the icon.
    fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "stop" }));
    const viaMenu = screen.getByText("stop a?").textContent;
    expect(stops(mounted.app)).toEqual([]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(icon("b", "stop")!);
    expect(screen.getByText("stop b?").textContent).toBe(viaMenu?.replace("a", "b"));
    expect(stops(mounted.app)).toEqual([]);
  });

  it("u428_no_stop_icon_on_a_stopped_agent", async () => {
    await mountRail([agent("a", "done", "done", { can_resume: true })], [exitedTerminal("a", 0)]);

    expect(icon("a", "stop")).toBeNull();
    expect(icon("a", "open folder")).not.toBeNull();
  });

  it("u428_open_folder_prefers_the_worktree", async () => {
    const mounted = await mountRail([agent("a", "idle", "i", { worktree: { path: "/p/wt/a", branch: "a", base: "main" } })]);

    fireEvent.click(icon("a", "open folder")!);

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p/wt/a", line: null }]));
  });

  it("u428_open_folder_falls_back_to_the_project_folder", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);

    fireEvent.click(icon("a", "open folder")!);

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p", line: null }]));
  });

  it("u428_open_in_editor_sends_the_same_directory", async () => {
    const mounted = await mountRail([agent("a", "idle", "i", { worktree: { path: "/p/wt/a", branch: "a", base: "main" } }), agent("b", "idle", "i")]);

    fireEvent.click(icon("a", "open in editor")!);
    fireEvent.click(icon("b", "open in editor")!);

    await waitFor(() => expect(mounted.app.openedEditors).toEqual(["/p/wt/a", "/p"]));
  });
});
