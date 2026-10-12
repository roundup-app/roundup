import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import styles from "../styles.css?inline";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
import { callsTo, mountPane } from "../terminal/paneHarness";
import { info, node } from "../testing/nodes";
import { drawerSliding } from "./sliding";

afterEach(cleanup);

const rule = (selector: string) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);

  return [...sheet.cssRules].find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === selector)?.cssText ?? "";
};

const setup = (reduced = false) => {
  const drawer = createDrawer();
  const [reducedMotion] = createSignal(reduced);
  render(() => (
    <>
      <input aria-label="composer" />
      <DrawerHost drawer={drawer} reducedMotion={reducedMotion} />
    </>
  ));

  return { drawer, panel: screen.getByLabelText("drawer") };
};

describe("u430 an open Drawer narrows the centre and covers none of it", () => {
  it("u430_centre_ends_where_the_drawer_begins", () => {
    expect(rule(".window:has(.drawer[data-open=\"true\"]) .columns")).toContain("width: calc(100% - var(--drawer-span))");
    expect(rule(".drawer")).toContain("width: var(--drawer-span)");
  });

  it("u430_drawer_text_selects_and_pastes_into_the_input", () => {
    expect(styles).not.toMatch(/\.drawer[^{]*\{[^}]*user-select:\s*none/);
  });

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

  it("u430_centre_and_drawer_share_one_motion", () => {
    const { drawer, panel } = setup();
    drawer.open(() => <p>detail</p>);

    expect(rule(".window:has(.drawer[data-motion=\"slide\"]) .columns")).toContain("width var(--duration-drawer) ease-out");
    expect(panel.style.transition).toBe("transform var(--duration-drawer) ease-out");
    expect(panel.dataset.motion).toBe("slide");
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
      const panel = screen.getByLabelText("drawer");
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
