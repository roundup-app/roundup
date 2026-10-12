import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, door, workstream } from "../testing/nodes";
import { LIST, selectNamed } from "../models/modelsFixture";
import { clearingOf } from "../thread/clear";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const icon = (row: string, label: string): HTMLElement => {
  const found = [...rowOf(row).querySelectorAll<HTMLElement>(".row-icons button")].find((button) => button.getAttribute("aria-label") === label);

  if (!found) throw new Error(`no ${label} icon on ${row}`);

  return found;
};

describe("u427 a Workstream row's icons", () => {
  it("u427_there_is_no_inside_add_line", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.rail.select("a");

    expect(document.querySelector(".rail-adds")).toBeNull();
    expect(rowOf("g").querySelector(".row-icons button")?.getAttribute("aria-label")).toBe("add agent");
  });

  it("u427_the_plus_icon_spawns_with_the_workstream_as_parent", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");

    fireEvent.click(icon("g", "add agent"));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g" }]));
    expect(icon("g", "add agent").title).toBe("add agent ⌘N");
  });

  it("u427_the_plus_icon_focuses_an_open_composing_field", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    const field = await screen.findByLabelText("Prompt");

    fireEvent.click(icon("g", "add agent"));

    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u427_the_plus_icon_keeps_the_model_pick", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["models.list"] = () => LIST;

    fireEvent.click(icon("g", "add agent"), { altKey: true });

    expect(await selectNamed("new agent model")).toBeTruthy();
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u427_the_clear_icon_opens_the_reason_prompt", async () => {
    const mounted = await mountRail([door("c1", "idle", "i")]);

    expect(icon("c1", "clear").title).toBe("clear workstream…");
    fireEvent.click(icon("c1", "clear"));

    expect(clearingOf(mounted.app, mounted.connected.events, "c1").phase()).toBe("asking");
    expect(mounted.app.calls.filter((call) => call.method === "workstream.clear")).toEqual([]);
  });

  it("u427_no_clear_icon_while_a_clear_is_pending", async () => {
    await mountRail([workstream("c2")]);

    fireEvent.click(icon("c2", "clear"));

    await waitFor(() => expect([...rowOf("c2").querySelectorAll(".row-icons button")].map((button) => button.getAttribute("aria-label"))).not.toContain("clear"));
  });

  it("u427_open_folder_opens_the_doors_directory", async () => {
    const mounted = await mountRail([workstream("g"), door("d", "idle", "i", { worktree: { path: "/p/.wt/d", branch: "d", base: "main" } })]);

    fireEvent.click(icon("g", "open folder"));
    fireEvent.click(icon("d", "open folder"));

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p", line: null }, { kind: "path", path: "/p/.wt/d", line: null }]));
  });

  it("u427_a_failed_open_shows_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.openFailure = new RpcError(-32001, "gone");

    fireEvent.click(icon("g", "open folder"));

    expect((await screen.findByText("gone")).className).toBe("ink");
  });

  it("u427_open_in_editor_sends_the_same_directory", async () => {
    const mounted = await mountRail([workstream("g")]);

    fireEvent.click(icon("g", "open in editor"));

    await waitFor(() => expect(mounted.app.editorOpened).toEqual(["/p"]));
  });

  it("u429_the_rail_shows_a_missing_editor_in_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.editorFailure = new RpcError(-32001, "no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR");

    fireEvent.click(icon("g", "open in editor"));

    expect((await screen.findByText(/no code editor found/)).className).toBe("ink");
  });
});
