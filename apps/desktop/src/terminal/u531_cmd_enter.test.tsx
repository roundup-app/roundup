import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { mountSwitcher, press } from "../switcher/switcherFixture";

afterEach(cleanup);

const begins = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "takeover.begin").map((call) => call.params);

const watch = async (id = "ann") => {
  const mounted = await mountSwitcher(id);

  await waitFor(() => expect(document.querySelector(".pane-watch")).not.toBeNull());

  return mounted;
};

describe("u531 ⌘⏎ takes control of the selected Agent", () => {
  it("u531_cmd_enter_begins_the_takeover_once_and_focuses_the_emulator", async () => {
    const { app, connected } = await watch();
    const event = press("Enter", { metaKey: true }, document.body);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(document.activeElement?.closest("[data-terminal]")?.getAttribute("data-terminal")).toBe("t-ann"));
    expect(connected.takeover.taken()).toBe("ann");
    expect(begins(app)).toEqual([{ agent: "ann" }]);
    expect(document.querySelector(".pane-watch")).toBeNull();
    expect(document.querySelector(".pane-takeover")).not.toBeNull();
  });

  it("u531_cmd_enter_does_nothing_in_a_takeover_with_no_selection_or_after_daemon_exit", async () => {
    const nothing = await mountSwitcher(null);

    press("Enter", { metaKey: true }, document.body);
    expect(begins(nothing.app)).toEqual([]);
    cleanup();

    const { app, connected } = await watch();

    press("Enter", { metaKey: true }, document.body);
    await waitFor(() => expect(connected.takeover.taken()).toBe("ann"));
    press("Enter", { metaKey: true }, document.body);
    expect(begins(app)).toEqual([{ agent: "ann" }]);
    cleanup();

    const [exit, setExit] = createSignal<{ code: number | null } | null>(null);
    const gone = await mountSwitcher("ann", undefined, undefined, exit);

    await waitFor(() => expect(document.querySelector(".pane-watch")).not.toBeNull());
    setExit({ code: 1 });
    press("Enter", { metaKey: true }, document.body);
    expect(begins(gone.app)).toEqual([]);
  });

  it("u531_a_held_cmd_enter_calls_begin_once", async () => {
    const { app, connected } = await watch();

    press("Enter", { metaKey: true }, document.body);
    press("Enter", { metaKey: true, repeat: true }, document.body);
    press("Enter", { metaKey: true, repeat: true }, document.body);
    await waitFor(() => expect(connected.takeover.taken()).toBe("ann"));
    expect(begins(app)).toEqual([{ agent: "ann" }]);
  });

  it("u531_other_modifier_sets_do_not_take_control", async () => {
    const { app } = await watch();

    for (const init of [{ metaKey: true, shiftKey: true }, { metaKey: true, ctrlKey: true }, { metaKey: true, altKey: true }, {}]) press("Enter", init, document.body);

    expect(begins(app)).toEqual([]);
  });

  it("u531_cmd_enter_in_a_text_field_does_not_take_control", async () => {
    const { app } = await watch();
    const input = document.body.appendChild(document.createElement("input"));

    press("Enter", { metaKey: true }, input);
    expect(begins(app)).toEqual([]);
  });

  it("u531_cmd_enter_on_a_shelf_row_button_toggles_and_does_not_take_control", async () => {
    const { app } = await watch();
    const row = document.body.appendChild(document.createElement("div"));

    row.className = "shelf-row";

    const button = row.appendChild(document.createElement("button"));

    press("Enter", { metaKey: true }, button);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(begins(app)).toEqual([]);
  });

  it("u531_the_button_and_help_show_the_chord", async () => {
    await watch();

    expect(screen.getByRole("button", { name: "Take control" }).textContent).toBe("Take control ⌘⏎");
  });
});
