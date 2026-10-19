import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { agent, door, workstream } from "../testing/nodes";
import { clearingOf } from "../rail/clear";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

// jsdom has no layout observer; U427's Chromium tests assert prompt placement and resizing.
beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    expect(rowOf("g").querySelector(".row-icons button")?.getAttribute("aria-label")).toBe("Add Agent");
  });

  it("u427_the_plus_icon_focuses_an_open_composing_field", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    const field = await screen.findByLabelText("Task");

    fireEvent.click(icon("g", "Add Agent"));

    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u427_the_clear_icon_opens_the_reason_prompt", async () => {
    const mounted = await mountRail([door("c1", "idle", "i")]);

    expect(icon("c1", "Clear Workstream…").getAttribute("aria-label")).toBe("Clear Workstream…");
    fireEvent.click(icon("c1", "Clear Workstream…"));

    expect(clearingOf(mounted.app, mounted.connected.events, "c1", mounted.connected.project.path).phase()).toBe("asking");
    expect(within(await screen.findByRole("dialog", { name: "Clear c1" })).getByRole("textbox", { name: "Why clear?" })).toBeTruthy();
    expect(mounted.rail.selected()).toBeNull();
    expect(mounted.app.calls.filter((call) => call.method === "workstream.clear")).toEqual([]);
  });

  it("u427_no_clear_icon_while_a_clear_is_pending", async () => {
    const mounted = await mountRail([workstream("c2")]);
    mounted.app.handlers["workstream.clear"] = () => ({ pending: true });

    fireEvent.click(icon("c2", "Clear Workstream…"));
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Why clear?" });
    fireEvent.input(reason, { target: { value: "next iteration" } });
    fireEvent.submit(reason.closest("form")!);
    await waitFor(() => expect(reason.disabled).toBe(true));

    await waitFor(() => expect([...rowOf("c2").querySelectorAll(".row-icons button")].map((button) => button.getAttribute("aria-label"))).not.toContain("Clear Workstream…"));
  });

  it("u427_open_folder_opens_the_doors_directory", async () => {
    const mounted = await mountRail([workstream("g"), door("d", "idle", "i", { worktree: { path: "/p/.wt/d", branch: "d", base: "main" } })]);

    fireEvent.click(icon("g", "Open folder"));
    fireEvent.click(icon("d", "Open folder"));

    await waitFor(() => expect(mounted.app.openedTargets).toEqual([{ kind: "path", path: "/p", line: null }, { kind: "path", path: "/p/.wt/d", line: null }]));
  });

  it("u427_a_failed_open_shows_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.openFailure = new RpcError(-32001, "gone");

    fireEvent.click(icon("g", "Open folder"));

    expect((await screen.findByText("gone")).className).toBe("ink");
  });

  it("u427_open_in_editor_sends_the_same_directory", async () => {
    const mounted = await mountRail([workstream("g")]);

    fireEvent.click(icon("g", "Open in editor"));

    await waitFor(() => expect(mounted.app.editorOpened).toEqual(["/p"]));
  });

  it("u429_the_rail_shows_a_missing_editor_in_one_failure_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.editorFailure = new RpcError(-32001, "no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR");

    fireEvent.click(icon("g", "Open in editor"));

    expect((await screen.findByText(/no code editor found/)).className).toBe("ink");
  });
});

it("u427_a_disabled_plus_calls_nothing", async () => {
  const mounted = await mountRail([workstream("g")], [], () => ({code:1}));

  expect(icon("g", "Add Agent").getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(icon("g", "Add Agent"));
  fireEvent.click(icon("g", "Add Agent"), {altKey:true});
  expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
});
