import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
import { callsTo, mountPane } from "../terminal/paneHarness";
import { info, node } from "../testing/nodes";
import { drawerSliding } from "./sliding";

afterEach(cleanup);

const setup = (reduced = false) => {
  const drawer = createDrawer();
  const [reducedMotion] = createSignal(reduced);
  render(() => (
    <>
      <input aria-label="composer" />
      <DrawerHost drawer={drawer} reducedMotion={reducedMotion} />
    </>
  ));

  return { drawer, panel: screen.getByLabelText("Drawer") };
};

describe("u430 an open Drawer narrows the centre and covers none of it", () => {
  it("u430_centre_input_leaves_the_drawer_open", () => {
    const { drawer } = setup();
    drawer.open(() => <p>detail</p>);
    const input = screen.getByLabelText("composer");

    fireEvent.pointerDown(input);
    fireEvent.click(input);
    input.focus();
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect([drawer.content() !== null, document.activeElement]).toEqual([true, input]);
  });

  it("u430_reduced_motion_moves_the_centre_at_once", () => {
    const { drawer, panel } = setup(true);
    drawer.open(() => <p>detail</p>);

    expect([panel.dataset.motion, panel.style.transition, drawerSliding()]).toEqual(["none", "none", false]);
  });

  it("u430_terminal_gets_one_resize_per_slide", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });

    try {
      const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);
      connected.rail.select("a");
      render(() => <DrawerHost drawer={connected.drawer} reducedMotion={() => false} />);
      const panel = screen.getByLabelText("Drawer");
      const emulator = emulators.get("t-a")!;
      const baseline = callsTo(app, "terminal.resize").length;

      for (const [open, cols] of [[true, 60], [false, 100]] as const) {
        if (open) connected.drawer.open(() => <p>detail</p>);
        else connected.drawer.close();

        // Pane schedules one refit per rAF; simulate size notifications during the slide.
        for (const width of [80, 70, cols]) {
          emulator.size = { cols: width, rows: 30 };
          window.dispatchEvent(new Event("resize"));
          vi.advanceTimersToNextFrame();
        }

        expect(callsTo(app, "terminal.resize")).toHaveLength(baseline + (open ? 0 : 1));
        fireEvent.transitionEnd(panel);
        vi.advanceTimersToNextFrame();
        expect(callsTo(app, "terminal.resize")).toHaveLength(baseline + (open ? 1 : 2));
        expect(callsTo(app, "terminal.resize").at(-1)).toEqual({ id: "t-a", cols, rows: 30 });
      }
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
});
