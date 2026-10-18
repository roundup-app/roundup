import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rowButtons = (row: string) => [...rowOf(row).querySelectorAll<HTMLElement>(".row-icons button")];

describe("u377 u378 the Rail offers no Model", () => {
  it("u377_no_app_screen_offers_a_model", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);

    fireEvent.keyDown(document, { key: ",", code: "Comma", metaKey: true });
    fireEvent.contextMenu(rowOf("a"));

    expect(screen.getAllByRole("menuitem").map((each) => each.textContent)).not.toContain("Model…");
    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Effort|Add agent|Default \(|Claude Code default/);
    expect(document.querySelector("select, [role=combobox], .models-sheet, .rail-agent-picker")).toBeNull();
    expect(mounted.app.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["models.list"]));
    expect(mounted.app.calls.map((call) => call.method)).not.toContain("project.setModels");
    expect(mounted.app.calls.map((call) => call.method)).not.toContain("agent.setModel");
  });
});

describe("u378 a Workstream row adds an Agent with one button", () => {
  it("u378_the_workstream_row_has_one_add_button", async () => {
    await mountRail([workstream("g")]);

    expect(rowButtons("g")[0]!.getAttribute("aria-label")).toBe("Add Agent");
    expect(document.querySelector(".rail-split-add")).toBeNull();
  });

  it("u378_the_add_passes_nothing", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");

    fireEvent.click(rowButtons("g")[0]!);

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: null, effort: null }]));
  });

  it("u378_the_add_honours_can_spawn_and_a_composing_field", async () => {
    const disabled = await mountRail([workstream("g")], [], () => ({ code: 1 }));

    expect(rowButtons("g")[0]!.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(rowButtons("g")[0]!);
    expect(railCallsTo(disabled.app, "agent.spawn")).toEqual([]);
    cleanup();

    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    const field = await screen.findByLabelText("Task");

    fireEvent.click(rowButtons("g")[0]!);

    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u378_a_failed_add_shows_the_error", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => { throw new Error("no room"); };

    fireEvent.click(rowButtons("g")[0]!);

    expect((await screen.findByText("no room")).className).toBe("ink");
  });

  it("u378_the_add_is_keyboard_complete", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
    fireEvent.mouseEnter(rowOf("g"));
    const add = screen.getByRole("button", { name: "Add Agent" });

    expect(add.tagName).toBe("BUTTON");
    add.focus();
    fireEvent.click(add);

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));
  });
});
