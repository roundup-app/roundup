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
  const { drawer, panel } = setup();

  drawer.open(() => <p>detail</p>);
  drawer.close();
  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);

  // The first slide's timer is gone; only the reopen's own completion ends the slide.
  vi.advanceTimersByTime(599);
  expect(drawerSliding()).toBe(true);
  fireEvent.transitionEnd(panel);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("detail")).not.toBeNull();
});

it("u3010b_dispose_mid_slide_clears_sliding", () => {
  const { drawer } = setup();

  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);
  cleanup();
  expect(drawerSliding()).toBe(false);
});

it("u3010b_exit_preserves_draft_and_submit_identity", () => {
  const { drawer, panel } = setup();

  drawer.open(() => <input aria-label="draft" />);
  const draft = screen.getByLabelText("draft") as HTMLInputElement;

  draft.value = "typed";
  drawer.close();
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(draft.value).toBe("typed");
  fireEvent.transitionEnd(panel);
  expect(screen.queryByLabelText("draft")).toBeNull();
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
