import { cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonExit } from "../app/seam";
import { node } from "../testing/nodes";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const line = () => document.querySelector('.pane-control[data-state="controlled"]');

const flagged = () => document.querySelector(".pane")!.hasAttribute("data-takeover");

describe("u407 the control line shows only while a Takeover of the selected Agent is held", () => {
  it("u407_no_row_and_no_takeover_shows_no_takeover_line", async () => {
    await mountPane([node("a")]);

    expect(line()).toBeNull();
    expect(flagged()).toBe(false);
  });

  it("u407_daemon_exited_shows_no_takeover_line", async () => {
    const [exit, setExit] = createSignal<DaemonExit | null>(null);
    await mountPane([node("a")], [], 0, exit);

    setExit({ code: 1 });

    expect(line()).toBeNull();
    expect(flagged()).toBe(false);
  });

  it("u407_a_held_takeover_shows_the_line_for_the_selected_agent", async () => {
    const { app, connected } = await mountPane([node("a")]);
    app.handlers["takeover.begin"] = () => null;

    connected.rail.select("a");
    await connected.takeover.begin("a");

    await vi.waitFor(() => expect(line()).not.toBeNull());
    expect(flagged()).toBe(true);
  });

  it("u407_a_held_takeover_with_no_row_selected_shows_no_line", async () => {
    const { app, connected } = await mountPane([node("a")]);
    app.handlers["takeover.begin"] = () => null;

    await connected.takeover.begin("a");

    expect(connected.takeover.taken()).toBe("a");
    expect(line()).toBeNull();
    expect(flagged()).toBe(false);
  });
});
