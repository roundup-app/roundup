import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
import { drawerSliding } from "./sliding";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const setup = () => {
  vi.useFakeTimers();
  const drawer = createDrawer();
  const [reduced, setReduced] = createSignal(false);
  render(() => <DrawerHost drawer={drawer} reducedMotion={reduced} />);

  return { drawer, setReduced, panel: screen.getByLabelText("Drawer") };
};

it("u3010b_latest_action_owns_layer_lifetime", () => {
  const { drawer, panel } = setup();

  drawer.open(() => <p>first</p>);
  drawer.close();
  expect(screen.queryByText("first")).not.toBeNull();
  expect(drawerSliding()).toBe(true);

  // Reopen before the exit finishes: neither the old timer nor the old completion may touch the new incarnation.
  drawer.open(() => <p>second</p>);
  vi.advanceTimersByTime(599);
  fireEvent.transitionEnd(panel);
  vi.advanceTimersByTime(600);
  expect(screen.queryByText("second")).not.toBeNull();
  expect(drawerSliding()).toBe(false);

  // A key close settles at once, with no completion to wait for.
  drawer.close("key");
  expect(screen.queryByText("second")).toBeNull();
  expect(drawerSliding()).toBe(false);
});

it("u3010b_stale_completion_has_no_new_layer_effect", () => {
  const { drawer } = setup();

  drawer.open(() => <p>detail</p>);
  drawer.close();
  vi.advanceTimersByTime(600);
  expect(screen.queryByText("detail")).toBeNull();
  expect(drawerSliding()).toBe(false);
});

it("u3010b_preference_change_preserves_destination_and_focus", () => {
  const { drawer, setReduced } = setup();

  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);

  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("detail")).not.toBeNull();

  drawer.close();
  expect(screen.queryByText("detail")).toBeNull();
});
