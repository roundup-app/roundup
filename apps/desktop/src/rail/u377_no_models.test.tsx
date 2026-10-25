import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


describe("u377 u378 the Rail offers no Model", () => {
  it("u377_no_app_screen_offers_a_model", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);

    fireEvent.keyDown(document, { key: ",", code: "Comma", metaKey: true });
    fireEvent.contextMenu(rowOf("a"));

    expect(mounted.app.menuLabels()).not.toContain("Model…");
    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Effort|Add agent|Default \(|Claude Code default/);
    expect(document.querySelector("select, [role=combobox], .models-sheet, .rail-agent-picker")).toBeNull();
    expect(mounted.app.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["models.list"]));
    expect(mounted.app.calls.map((call) => call.method)).not.toContain("project.setModels");
    expect(mounted.app.calls.map((call) => call.method)).not.toContain("agent.setModel");
  });
});
