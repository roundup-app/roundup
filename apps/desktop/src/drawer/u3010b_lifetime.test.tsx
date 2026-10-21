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
  const submit = vi.fn();

  drawer.open(() => (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea aria-label="draft" />
      <button type="submit">Send</button>
    </form>
  ));
  // SAFETY: the element rendered above is a `<textarea>`.
  const draft = screen.getByLabelText("draft") as HTMLTextAreaElement;

  draft.value = "line one\nline two";
  drawer.close();

  // The retained exit is the same element with the exact text, and takes no new activation.
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(draft.value).toBe("line one\nline two");
  expect(panel.dataset["open"]).toBe("false");

  fireEvent.transitionEnd(panel);
  expect(screen.queryByLabelText("draft")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it("u3010b_preference_change_preserves_destination_and_focus", () => {
  const { drawer, setReduced, panel } = setup();

  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);
  expect(panel.contains(document.activeElement)).toBe(true);

  // Opening: reduced motion settles the latest destination, content and focus stay.
  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("detail")).not.toBeNull();
  expect(panel.contains(document.activeElement)).toBe(true);

  // Turning it off replays nothing.
  setReduced(false);
  expect(drawerSliding()).toBe(false);

  // Closing and reversal: the latest destination wins and the exit content is gone at once.
  drawer.close();
  expect(drawerSliding()).toBe(true);
  drawer.open(() => <p>again</p>);
  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("again")).not.toBeNull();

  setReduced(false);
  drawer.close();
  expect(screen.queryByText("again")).not.toBeNull();
  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("again")).toBeNull();
});
