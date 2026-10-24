import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openSwitcher, field, mountSwitcher, switcherKey as press, rows } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = async (text: string, row: string) => {
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: text } });
  await waitFor(() => expect(rows()[0]).toBe(row));
};

const begins = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "takeover.begin").map((call) => call.params);

describe("u530 ⇧⏎ in the Switcher takes control", () => {
  it("u530_shift_enter_selects_begins_the_takeover_once_and_focuses_the_emulator", async () => {
    const { app, connected } = await mountSwitcher();

    await open("ann", "Ann");
    press("Enter", { shiftKey: true }, field()!);

    await waitFor(() => expect(connected.takeover.taken()).toBe("ann"));
    expect(begins(app)).toEqual([{ agent: "ann" }]);
    expect(connected.rail.selected()).toBe("ann");
    expect(field()).toBeNull();
    await waitFor(() => expect(document.activeElement?.closest("[data-terminal]")?.getAttribute("data-terminal")).toBe("t-ann"));
  });

  it("u530_shift_enter_on_a_group_acts_as_enter", async () => {
    const { app, connected } = await mountSwitcher();

    await open("ops", "ops");
    press("Enter", { shiftKey: true }, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
    expect(begins(app)).toEqual([]);
    expect(field()).toBeNull();
  });

  it("u530_a_conflict_stays_in_watch_with_the_failure_line", async () => {
    const { app, connected, failures } = await mountSwitcher();

    app.handlers["takeover.begin"] = () => { throw new Error("Cy is done"); };

    await open("cy", "Cy");
    press("Enter", { shiftKey: true }, field()!);

    await waitFor(() => expect(failures.at(-1)).toBe("Cy is done"));
    expect(connected.rail.selected()).toBe("cy");
    expect(connected.takeover.taken()).toBeNull();
    expect(document.querySelector(".pane-control[data-state=managed]")).not.toBeNull();
  });
});
