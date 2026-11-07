import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, door, workstream } from "../testing/nodes";
import { chooseAction, mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

describe("u427 a Workstream row's icons", () => {
  it("u427_there_is_no_inside_add_line", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.rail.select("a");

    expect(document.querySelector(".rail-adds")).toBeNull();

  });

  it("u427_the_plus_icon_focuses_an_open_composing_field", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    const field = await screen.findByLabelText("Work");

    await chooseAction(mounted.app, "g", "Agent");

    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });


  it.each([null, { path: "/p/.wt/d", branch: "d", base: "main" }])("u427_open_folder_opens_the_doors_directory_%s", async worktree => {
    const mounted = await mountRail([workstream("selected"), door("d", "idle", "i", { worktree })]);
    mounted.rail.select("selected");
    await chooseAction(mounted.app, "d", "Open directory");
    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: worktree ? "/p/.wt/d" : "/p", line: null }]));
    expect(mounted.rail.selected()).toBe("selected");
  });

  it("u427_a_failed_open_shows_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.openFailure = new RpcError(-32001, "gone");

    await chooseAction(mounted.app, "g", "Open directory");

    expect((await screen.findByText("gone")).className).toBe("ink");
  });

  it.each([null, { path: "/p/.wt/d", branch: "d", base: "main" }])("u427_open_in_editor_sends_the_same_directory_%s", async worktree => {
    const mounted = await mountRail([door("g", "idle", "i", { worktree })]);

    await chooseAction(mounted.app, "g", "Open in editor");

    await waitFor(() => expect(mounted.app.editorOpened).toEqual([worktree ? "/p/.wt/d" : "/p"]));
  });

  it("u429_the_rail_shows_a_missing_editor_in_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.editorFailure = new RpcError(-32001, "no code editor found; choose one in Settings");

    await chooseAction(mounted.app, "g", "Open in editor");

    expect(await screen.findAllByText(/no code editor found/)).toHaveLength(1);
  });
});

it("u427_an_unavailable_add_is_omitted_and_calls_nothing", async () => {
  const mounted = await mountRail([workstream("g")], [], () => ({code:1}));

  fireEvent.contextMenu(rowOf("g"));
  expect(mounted.app.menuLabels()).not.toContain("Add");
  await mounted.app.closeMenu();

  expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
});

it("u427_folder_and_editor_are_menu_only", async () => {
  const { app } = await mountRail([door("g", "idle", "ready")]);

  for (const label of ["Open directory", "Open in editor"]) {
    expect(within(rowOf("g")).queryByRole("button", { name: label })).toBeNull();
  }

  fireEvent.contextMenu(rowOf("g"));
  expect(app.menuLabels()).toEqual(expect.arrayContaining(["Open directory", "Open in editor"]));
});
