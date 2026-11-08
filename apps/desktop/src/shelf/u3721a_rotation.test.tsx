import { batch } from "solid-js";
import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";

afterEach(() => {
  batch(cleanup);
  localStorage.clear();
});

const mount = async (shelfOpen: boolean) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  const controls = seedApp("tree-40", Date.now());

  render(() => <App initialShelfOpen={shelfOpen} prepareIdle={open => open.showView("workstreams")} app={controls.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await waitFor(() => expect(document.querySelector('[aria-label="Ask"]')).not.toBeNull());
};

// SAFETY: the mounted App always renders its one window and Drawer.
const windowOf = () => document.querySelector<HTMLElement>(".window") as HTMLElement;
// SAFETY: DrawerHost renders its aside whether or not it is open.
const drawer = () => document.querySelector<HTMLElement>(".drawer") as HTMLElement;
const press = () => leaderKey("KeyB", {}, document.body);

/** The Bench's size as the user sees it: the window's and the Drawer's own marks. */
const size = () => {
  if (drawer().dataset["open"] === "true") return windowOf().dataset["shelfMode"] === "reserved" && drawer().dataset["maximised"] === "true" ? "full" : "item";

  if (windowOf().dataset["shelf"] !== "open") return "closed";

  return windowOf().dataset["shelfMaximised"] === "true" ? "full" : "list";
};

const stored = () => JSON.parse(localStorage.getItem("roundup:shelf:/Users/you/harness") ?? "null");

const steps = async (expected: string[]) => {
  for (const next of expected) {
    press();
    await waitFor(() => expect(size()).toBe(next));
  }
};

describe("U3721a", () => {
  it("u3721a_the_leader_b_steps_closed_list_item_full_closed_in_reserved_mode", async () => {
    await mount(false);
    await steps(["list", "full", "closed", "list"]);
  });

  it("u3721a_overlay_mode_skips_full", async () => {
    await mount(false);
    await steps(["list"]);
    windowOf().dataset["shelfMode"] = "overlay";
    await steps(["closed", "list"]);
  });

  it("u3721a_the_state_per_project_follows_each_step_and_esc_still_closes", async () => {
    await mount(false);
    await steps(["list", "full"]);
    await waitFor(() => expect(stored().maximised).toBe(true));
    press();
    await waitFor(() => expect(size()).toBe("closed"));
    await waitFor(() => expect(stored()).toMatchObject({ open: false, maximised: false }));
    await steps(["list"]);
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(size()).toBe("closed"));
  });
});
