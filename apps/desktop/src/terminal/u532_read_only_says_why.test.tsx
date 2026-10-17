import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { callsTo } from "./paneHarness";
import { mountSwitcher, press } from "../switcher/switcherFixture";

afterEach(cleanup);

const band = () => document.querySelector(".pane-watch > span")?.textContent;

const watchedPane = async () => {
  const mounted = await mountSwitcher("ann");

  await waitFor(() => expect(document.querySelector(".pane-watch")).not.toBeNull());
  press("2", { metaKey: true }, document.body);
  await waitFor(() => expect(document.activeElement?.closest(".pane-screen")).not.toBeNull());

  return mounted;
};

describe("u532 typing into a watched input says why nothing was sent", () => {
  it("u532_a_key_in_a_watched_pane_writes_nothing_and_the_band_says_why", async () => {
    const { app, connected } = await watchedPane();

    expect(band()).toBe("Watching Ann: Read-only");

    for (const key of ["h", "Enter", "Backspace", "ArrowUp"]) {
      press(key);
      expect(band()).toBe("Read-only. ⌘⏎ takes control");
    }

    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(connected.rail.selected()).toBe("ann");
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
    expect(document.querySelector('[role="alert"], .toast')).toBeNull();
  });

  it("u532_the_band_reverts_when_focus_leaves_or_the_takeover_begins", async () => {
    await watchedPane();

    press("h");
    document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!.focus();
    await waitFor(() => expect(band()).toBe("Watching Ann: Read-only"));

    document.querySelector<HTMLElement>(".pane-screen [tabindex]")!.focus();
    press("h");
    expect(band()).toBe("Read-only. ⌘⏎ takes control");
    press("Enter", { metaKey: true });
    await waitFor(() => expect(document.querySelector(".pane-takeover")?.textContent).toContain("Control: Typing goes straight to Ann"));
    expect(document.querySelector(".pane-watch")).toBeNull();
  });

  it("u532_chords_and_copy_still_act_in_watch", async () => {
    const { connected } = await watchedPane();

    press("1", { metaKey: true });
    expect(document.activeElement?.closest('[role="tree"]')).not.toBeNull();
    document.querySelector<HTMLElement>(".pane-screen [tabindex]")!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "c", metaKey: true });
    expect(band()).toBe("Watching Ann: Read-only");
    expect(connected.takeover.taken()).toBeNull();
  });
});
