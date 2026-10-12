import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { LIST, selectNamed } from "../models/modelsFixture";
import { clearingOf } from "../thread/clear";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const icon = (row: string, label: string): HTMLElement => {
  const found = rowOf(row).querySelector<HTMLElement>(`.rail-icons [aria-label="${label}"]`);

  if (!found) throw new Error(`no ${label} on ${row}`);

  return found;
};

describe("u427 a Workstream row's icons", () => {
  it("u427_there_is_no_inside_add_line", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.rail.select("a");

    expect(document.querySelector(".rail-adds")).toBeNull();
    expect(rowOf("a").nextElementSibling).toBeNull();
    expect([...document.querySelectorAll("[role=tree] > *")].map((each) => each.getAttribute("data-id"))).toEqual(["g", "a"]);
  });

  it("u427_the_plus_icon_spawns_with_the_workstream_as_parent", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" }), workstream("h")]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");

    const plus = icon("g", "Add Agent");

    expect(plus.title).toBe("Add Agent ⌘N");
    fireEvent.click(plus);
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g" }]));
  });

  it("u427_the_plus_icon_focuses_an_open_composing_field", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    const field = await screen.findByLabelText("Prompt");

    fireEvent.click(icon("g", "Add Agent"));

    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u427_the_plus_icon_is_disabled_and_silent_when_it_cannot_spawn", async () => {
    const mounted = await mountRail([workstream("g")], [], () => ({ code: 1, signal: null }));

    fireEvent.click(icon("g", "Add Agent"));

    expect(icon("g", "Add Agent").getAttribute("aria-disabled")).toBe("true");
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u427_a_failed_add_shows_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => {
      throw new RpcError(-32000, "no claude on PATH");
    };

    fireEvent.click(icon("g", "Add Agent"));

    expect((await screen.findByText("no claude on PATH")).className).toBe("ink");
  });

  it("u427_the_plus_icon_keeps_the_model_pick", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["models.list"] = () => LIST;
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");

    fireEvent.click(icon("g", "Add Agent"), { altKey: true });
    fireEvent.change(await selectNamed("new agent model"), { target: { value: "m-sonnet" } });
    fireEvent.click(icon("g", "Add Agent"));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: "m-sonnet" }]));
    expect(screen.queryByRole("dialog", { name: "new agent" })).toBeNull();
  });

  it("u427_the_clear_icon_opens_the_reason_prompt", async () => {
    const mounted = await mountRail([workstream("g")]);
    const clearing = clearingOf(mounted.app, mounted.connected.events, "g");

    expect(icon("g", "Clear").title).toBe("Clear Workstream…");
    fireEvent.click(icon("g", "Clear"));

    expect(clearing.phase()).toBe("asking");
    expect(railCallsTo(mounted.app, "workstream.clear")).toEqual([]);
  });

  it("u427_no_clear_icon_while_a_clear_is_pending", async () => {
    const mounted = await mountRail([workstream("g")]);
    const clearing = clearingOf(mounted.app, mounted.connected.events, "g");
    mounted.app.handlers["workstream.clear"] = () => new Promise(() => {});

    clearing.open();
    void clearing.submit(true);

    await waitFor(() => expect(rowOf("g").querySelector('[aria-label="Clear"]')).toBeNull());
  });

  it("u427_open_folder_opens_the_doors_directory", async () => {
    const mounted = await mountRail([
      door("d", "idle", "idle", { worktree: { path: "/p/wt/d", branch: "d", base: "main" } }),
      door("e", "idle", "idle"),
    ]);

    fireEvent.click(icon("d", "Open folder"));
    fireEvent.click(icon("e", "Open folder"));

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([
      { kind: "path", path: "/p/wt/d", line: null },
      { kind: "path", path: "/p", line: null },
    ]));
  });

  it("u427_a_failed_open_shows_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.openFailure = new RpcError(-32001, "not found: /p");

    fireEvent.click(icon("g", "Open folder"));

    expect((await screen.findByText("not found: /p")).closest("p")?.getAttribute("role")).toBe("alert");
  });

  it("u427_open_in_editor_sends_the_same_directory", async () => {
    const mounted = await mountRail([
      door("d", "idle", "idle", { worktree: { path: "/p/wt/d", branch: "d", base: "main" } }),
      door("e", "idle", "idle"),
    ]);

    fireEvent.click(icon("d", "Open in editor"));
    fireEvent.click(icon("e", "Open in editor"));

    await waitFor(() => expect(mounted.app.openedEditors).toEqual(["/p/wt/d", "/p"]));
  });

  it("u429_the_rail_shows_a_missing_editor_in_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.editorFailure = new RpcError(-32001, "no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR");

    fireEvent.click(icon("g", "Open in editor"));

    const line = await screen.findByText("no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR");
    expect(line.closest("p")?.getAttribute("role")).toBe("alert");
  });
});
