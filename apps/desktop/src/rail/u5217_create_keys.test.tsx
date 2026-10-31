import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream, door } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const press = (init: KeyboardEventInit) => fireEvent.keyDown(document, init);

const footer = (label: string) => screen.getByRole("button", { name: label });

describe("u5217 the footer buttons show their key", () => {
  it("u5217_each_footer_button_exposes_its_chord_as_its_shortcut", async () => {
    await mountRail([workstream("g")]);

    expect(footer("Add Workstream").getAttribute("aria-keyshortcuts")).toBe("Alt+Meta+N");
    expect(footer("New Mode").getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+M");
    expect(footer("New Agent").getAttribute("aria-keyshortcuts")).toBe("Meta+N");
    expect(footer("Add Workstream").querySelector("kbd")).not.toBeNull();
    expect(footer("New Mode").querySelector("kbd")).not.toBeNull();
    expect(footer("New Agent").querySelector("kbd")).not.toBeNull();
  });

  it("u5217_a_button_runs_the_action_its_chord_runs", async () => {
    const byClick = await mountRail([workstream("g")]);
    byClick.app.handlers["rail.createWorkstream"] = () => door("w1", "idle", "idle");
    fireEvent.click(footer("Add Workstream"));
    await waitFor(() => expect(railCallsTo(byClick.app, "rail.createWorkstream")).toHaveLength(1));
    cleanup();

    const byChord = await mountRail([workstream("g")]);
    byChord.app.handlers["rail.createWorkstream"] = () => door("w1", "idle", "idle");
    press({ key: "n", code: "KeyN", altKey: true, metaKey: true });
    await waitFor(() => expect(railCallsTo(byChord.app, "rail.createWorkstream")).toHaveLength(1));
  });
});
