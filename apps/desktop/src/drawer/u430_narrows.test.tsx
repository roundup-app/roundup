import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
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
});
