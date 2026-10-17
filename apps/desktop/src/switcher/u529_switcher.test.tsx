import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { callsTo } from "../terminal/paneHarness";
import { cmdK, field, mountSwitcher, press, rows } from "./switcherFixture";

afterEach(cleanup);

const type = (text: string) => fireEvent.input(field()!, { target: { value: text } });

const methods = (app: { calls: { method: string }[] }) => app.calls.map((call) => call.method);

describe("u529 ⌘K switches to an Agent or Terminal by name", () => {
  it("u529_cmd_k_lists_agents_doors_groups_and_terminals_and_filters_as_you_type", async () => {
    await mountSwitcher();
    cmdK();
    await waitFor(() => expect(field()).not.toBeNull());

    expect(document.activeElement).toBe(field());
    // error, then needs-you, then Rail order; the Terminal last with its Workstream's name.
    expect(rows()).toEqual(["Cy", "Bob", "lead", "Ann", "ops", "Dee", "build shell ops"]);

    type("AN");
    await waitFor(() => expect(rows()).toEqual(["Ann"]));

    type("zzz");
    await waitFor(() => expect(document.querySelector(".switcher")!.textContent).toContain("No match"));
    expect(rows()).toEqual([]);
  });

  it("u529_enter_on_an_agent_selects_it_and_focuses_the_pane", async () => {
    const { connected, app } = await mountSwitcher();
    const before = app.calls.length;

    cmdK();
    await waitFor(() => expect(field()).not.toBeNull());
    type("dee");
    await waitFor(() => expect(rows()).toEqual(["Dee"]));
    press("Enter", {}, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("dee"));
    expect(field()).toBeNull();
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
    expect(methods(app).slice(before)).not.toContain("takeover.begin");
  });

  it("u529_enter_on_a_terminal_shows_its_bubble_and_focuses_its_emulator", async () => {
    const { connected } = await mountSwitcher();

    cmdK();
    await waitFor(() => expect(field()).not.toBeNull());
    type("build");
    await waitFor(() => expect(rows()).toEqual(["build shell ops"]));
    press("Enter", {}, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
    await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("7"));
  });

  it("u529_escape_returns_focus_and_calls_nothing", async () => {
    const { app } = await mountSwitcher();
    const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;

    origin.focus();

    const calls = app.calls.length;

    cmdK();
    await waitFor(() => expect(field()).not.toBeNull());
    press("Escape", {}, field()!);

    await waitFor(() => expect(field()).toBeNull());
    expect(document.activeElement).toBe(origin);
    expect(app.calls.length).toBe(calls);
  });

  it("u529_cmd_k_again_closes_and_other_modifier_sets_and_other_chords_do_nothing", async () => {
    const { connected } = await mountSwitcher();

    press("k", { metaKey: true, shiftKey: true });
    press("k");
    expect(field()).toBeNull();

    cmdK();
    await waitFor(() => expect(field()).not.toBeNull());
    press("j", { metaKey: true }, field()!);
    expect(connected.rail.selected()).toBeNull();
    cmdK();
    await waitFor(() => expect(field()).toBeNull());
    expect(callsTo((await mountSwitcher()).app, "terminal.write")).toEqual([]);
  });
});
