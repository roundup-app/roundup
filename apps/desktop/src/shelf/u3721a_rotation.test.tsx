import { batch } from "solid-js";
import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";

afterEach(async () => {
  batch(cleanup);
  // The frame's last write is asynchronous; clearing first would let it land in the next test's storage.
  await new Promise(done => setTimeout(done, 100));
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
    // SAFETY: the open Shelf renders its Todos tab.
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(each => each.textContent?.startsWith("Todos")) as HTMLElement;

    fireEvent.keyDown(tab, { key: "Escape" });
    await waitFor(() => expect(size()).toBe("closed"));
  });

  it("u3721a_the_leader_b_opens_the_focused_row_then_maximises_it_then_closes", async () => {
    await mount(false);
    await steps(["list"]);
    const rowsOf = () => [...document.querySelectorAll<HTMLButtonElement>(".todos-tab [data-shelf-row] .row-head .todo-row-button")].filter(each => each.closest("[hidden], [inert]") === null);

    // The seeded Todos all sit in the Unassigned group, which starts folded.
    await waitFor(() => expect(document.querySelector('.todos-tab [aria-expanded="false"]')).not.toBeNull());
    fireEvent.click(document.querySelector('.todos-tab [aria-expanded="false"]') as HTMLElement);
    await waitFor(() => expect(rowsOf().length).toBeGreaterThan(0));
    const row = rowsOf()[0] as HTMLButtonElement;


    row.focus();
    leaderKey("KeyB", {}, row);
    await waitFor(() => expect(size()).toBe("item"));
    await steps(["full", "closed"]);
  });
});
