import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { agent } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { openTabs, path, rowSelected, tab, projectTabs } from "./stripFixture";

afterEach(cleanup);

const chord = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const press = new KeyboardEvent("keydown", { code, key: code, metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(press);

  return press;
};

const open = () => projectTabs().find((entry) => entry.getAttribute("aria-selected") === "true")?.textContent?.replace(/[●◉]/, "");

describe("u186 keys", () => {
  it("u186_next_and_previous_wrap_at_the_ends", async () => {
    await openTabs({ api: [], web: [], docs: [] });

    expect(open()).toBe("docs");

    chord("BracketRight");
    await waitFor(() => expect(open()).toBe("api"));

    chord("BracketLeft");
    await waitFor(() => expect(open()).toBe("docs"));

    chord("BracketLeft");
    await waitFor(() => expect(open()).toBe("web"));
  });

  it("u186_shift_cmd_j_goes_to_the_next_marked_project_and_selects_its_most_urgent_agent", async () => {
    await openTabs({
      api: [agent("a1", "needs-you", "x"), agent("a2", "error", "x")],
      web: [],
      docs: [agent("d1", "needs-you", "x")],
    });

    chord("KeyJ");
    await waitFor(() => expect(open()).toBe("api"));
    await waitFor(() => expect(rowSelected("a2")).toBe("true"));

    chord("KeyJ");
    await waitFor(() => expect(open()).toBe("docs"));
  });

  it("u186_with_one_marked_project_it_acts_as_cmd_j_and_with_none_changes_nothing", async () => {
    await openTabs({ api: [agent("a", "idle", "x")], web: [agent("w1", "needs-you", "x")] });

    chord("KeyJ");
    await waitFor(() => expect(rowSelected("w1")).toBe("true"));
    expect(open()).toBe("web");

    cleanup();
    await openTabs({ api: [agent("a", "idle", "x")], web: [agent("w", "idle", "x")] });

    chord("KeyJ");

    expect(open()).toBe("web");
  });

  it("u186_chord_rules_other_modifiers_a_held_key_and_one_project", async () => {
    await openTabs({ api: [], web: [] });

    chord("BracketRight", { shiftKey: false });
    chord("BracketRight", { altKey: true });
    chord("BracketRight", { ctrlKey: true });
    expect(open()).toBe("web");

    chord("BracketRight", { repeat: true });
    expect(open()).toBe("web");

    const first = chord("BracketLeft");

    expect(first.defaultPrevented).toBe(true);
    await waitFor(() => expect(open()).toBe("api"));
  });

  it("u186_caps_lock_is_neutral", async () => {
    await openTabs({ api: [], web: [] });

    chord("BracketLeft", { key: "{" });

    await waitFor(() => expect(open()).toBe("api"));
  });

  it("u186_one_project_does_nothing", async () => {
    await openTabs({ api: [] });

    const press = chord("BracketRight");

    expect(open()).toBe("api");
    expect(press.defaultPrevented).toBe(true);
  });

  it("u186_cmd_1_cmd_2_and_alt_1_act_on_the_open_project_only", async () => {
    await openTabs({ api: [agent("a1", "idle", "x")], web: [agent("w1", "idle", "x")] });

    await waitFor(() => expect(document.querySelector('[data-id="w1"]')).not.toBeNull());
    (document.querySelector<HTMLElement>('[data-id="w1"]'))!.focus();
    chord("Digit2", { shiftKey: false }, document.querySelector('[data-id="w1"]')!);
    chord("Digit1", { shiftKey: false }, document.querySelector('[data-id="w1"]')!);

    expect(document.activeElement?.closest(".rail")).not.toBeNull();
    expect(document.querySelector('[data-id="a1"]')).toBeNull();
    expect(open()).toBe("web");
  });

  it("u186_a_restart_shows_the_stored_order_and_names_and_the_open_tab_again", async () => {
    const { app } = await openTabs({ api: [], web: [], docs: [] });

    await app.renameProject(path("web"), "payments");
    tab("api").click();
    await waitFor(() => expect(open()).toBe("api"));
    cleanup();

    render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);

    await waitFor(() => expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "payments", "docs"]));
    expect(open()).toBe("api");
  });

  it("u186_a_stored_tab_that_is_no_longer_open_is_treated_as_absent", async () => {
    window.localStorage.setItem("roundup:open-tab", JSON.stringify("/gone"));
    const { app } = await openTabs({ api: [], web: [] });

    window.localStorage.setItem("roundup:open-tab", JSON.stringify("/gone"));
    cleanup();
    render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);

    await waitFor(() => expect(projectTabs()).toHaveLength(2));
    expect(projectTabs().filter((entry) => entry.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });
});
