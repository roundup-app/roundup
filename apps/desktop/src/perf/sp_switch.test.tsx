import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { field, mountSwitcher, openSwitcher, switcherKey as press } from "../switcher/switcherFixture";
import { createSwitchProbe } from "./switch";

afterEach(() => { cleanup(); localStorage.clear(); });

const probed = () => {
  let at = 0;
  const ticking = () => (at += 5);
  const timers: (() => void)[] = [];
  const probe = createSwitchProbe(ticking, document, (_ms, run) => timers.push(run), () => {});

  return { probe, stop: probe.start(), expire: () => timers.forEach(run => run()) };
};

const type = (text: string) => {
  field()!.value = text;
  field()!.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("sp2 a Switcher-open sample", () => {
  it("sp2_switcher_open", async () => {
    const { probe, stop } = probed();

    await mountSwitcher();
    openSwitcher();
    await waitFor(() => expect(probe.samples().open.length).toBe(1));
    expect(probe.samples().open).toEqual([5]);
    expect(probe.dropped().open).toBe(0);
    stop();
  });

  it("sp2_a_switcher_that_does_not_appear_is_dropped_and_counted", async () => {
    const { probe, stop, expire } = probed();

    await mountSwitcher();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", metaKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", bubbles: true }));
    expire();
    expect(probe.dropped().open).toBe(1);
    expect(probe.samples().open).toEqual([]);
    stop();
  });
});

describe("sp3 a switch sample", () => {
  it("sp3_switch", async () => {
    const { probe, stop } = probed();
    const { connected } = await mountSwitcher();

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("dee");
    await waitFor(() => expect(document.querySelector(".switcher [data-highlighted]")).not.toBeNull());
    press("Enter", {}, field()!);
    await waitFor(() => expect(connected.rail.selected()).toBe("dee"));
    await waitFor(() => expect(probe.samples().switch).toEqual([5]));
    stop();
  });

  it("sp3_a_target_already_shown_records_no_sample", async () => {
    const { probe, stop, expire } = probed();

    await mountSwitcher("dee");

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("dee");
    await waitFor(() => expect(document.querySelector(".switcher [data-highlighted]")).not.toBeNull());
    press("Enter", {}, field()!);
    await waitFor(() => expect(field()).toBeNull());
    expire();
    expect(probe.samples().switch).toEqual([]);
    expect(probe.dropped().switch).toBe(0);
    stop();
  });
});
