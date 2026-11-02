import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream, door } from "../testing/nodes";
import { mountRail, railCallsTo } from "../rail/railFixture";
import { captureActions } from "./registry";

afterEach(cleanup);

const workstreamChord = { key: "n", code: "KeyN", altKey: true, metaKey: true };

const modeChord = { key: "M", code: "KeyM", shiftKey: true, metaKey: true };

const press = (init: KeyboardEventInit) => fireEvent.keyDown(document, init);

describe("u5216 Workstream and Mode each have a chord", () => {
  it("u5216_alt_cmd_n_creates_a_workstream_once", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["rail.createWorkstream"] = () => door("w1", "idle", "idle");

    press(workstreamChord);
    await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(1));
    press({ ...workstreamChord, ctrlKey: true });
    press({ key: "n", code: "KeyN", altKey: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u5216_shift_cmd_m_opens_the_mode_field", async () => {
    await mountRail([workstream("g")]);

    press(modeChord);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("u5216_a_repeat_or_a_busy_create_acts_once_or_not_at_all", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["rail.createWorkstream"] = () => new Promise(() => undefined);

    press({ ...workstreamChord, repeat: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(0);

    press(workstreamChord);
    await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(1));
    press(workstreamChord);
    press(modeChord);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("u5216_help_and_the_k_entries_list_both_chords", async () => {
    await mountRail([workstream("g")]);

    const listed = captureActions(document.activeElement).filter(action => action.keys === "⌥⌘N" || action.keys === "⇧⌘M").map(action => [action.keys, action.label]);

    expect(listed).toEqual(expect.arrayContaining([["⌥⌘N", "New Workstream"], ["⇧⌘M", "New Mode"]]));
  });
});
