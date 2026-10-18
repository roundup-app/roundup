import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { callsTo } from "./paneHarness";
import { mountSwitcher, press } from "../switcher/switcherFixture";

afterEach(cleanup);

const band = () => document.querySelector(".pane-control-state")?.textContent;

const watchedPane = async () => {
  const mounted = await mountSwitcher("ann");

  await waitFor(() => expect(document.querySelector(".pane-control[data-state=managed]")).not.toBeNull());
  document.querySelector<HTMLElement>(".pane-screen [tabindex]")!.focus();
  await waitFor(() => expect(document.activeElement?.closest(".pane-screen")).not.toBeNull());

  return mounted;
};

describe("u532 typing into a watched input says why nothing was sent", () => {
  it("u532_a_key_in_a_watched_pane_writes_nothing_and_the_band_says_why", async () => {
    const { app, connected, emulators } = await watchedPane();

    expect(band()).toBe("Managed");

    for (const bytes of ["h", "\r", "\x7f", "\x1b[A"]) {
      emulators.made.get("t-ann")!.type(new TextEncoder().encode(bytes));
      expect(band()).toBe("Managed: typing is not sent");
    }

    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(connected.rail.selected()).toBe("ann");
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
    expect(document.querySelector('[role="alert"], .toast')).toBeNull();
  });

  it("u532_the_band_reverts_when_focus_leaves_or_the_takeover_begins", async () => {
    const { emulators } = await watchedPane();
    const type = () => emulators.made.get("t-ann")!.type(new TextEncoder().encode("h"));

    type();
    document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!.focus();
    await waitFor(() => expect(band()).toBe("Managed"));

    document.querySelector<HTMLElement>(".pane-screen [tabindex]")!.focus();
    type();
    expect(band()).toBe("Managed: typing is not sent");
    press("Enter", { metaKey: true });
    await waitFor(() => expect(document.querySelector(".pane-control[data-state=controlled]")?.textContent).toContain("You control"));
    expect(document.querySelector(".pane-control[data-state=managed]")).toBeNull();
  });

  it("u532_chords_and_copy_still_act_in_watch", async () => {
    const { connected } = await watchedPane();

    document.querySelector<HTMLElement>(".pane-screen [tabindex]")!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "c", metaKey: true });
    expect(band()).toBe("Managed");
    expect(connected.takeover.taken()).toBeNull();
  });
});
