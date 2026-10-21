import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountBubbles } from "./bubblesFixture";

afterEach(cleanup);

const fire = (type: string, target: Element | Window, x: number, y: number, buttons: number) => {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 2, buttons, bubbles: true, cancelable: true });

  Object.defineProperty(event, "pointerType", { value: "mouse" });
  target.dispatchEvent(event);

  return event;
};

/** The press and the `contextmenu` as macOS orders them (both on the button going down), then a move and the release. */
const rightPress = (tab: Element, moveTo: number) => {
  fire("pointerdown", tab, 10, 10, 2);
  const menu = fire("contextmenu", tab, 10, 10, 2);

  fire("pointermove", window, 10 + moveTo, 10, 2);
  fire("pointerup", tab, 10 + moveTo, 10, 0);

  return menu;
};

it("u2694e_a_right_click_opens_the_menu_on_release", async () => {
  const { app } = await mountBubbles();
  const tab = document.querySelector(".terminal-tab-pair")!;

  fire("pointerdown", tab, 10, 10, 2);
  const menu = fire("contextmenu", tab, 10, 10, 2);
  expect(menu.defaultPrevented).toBe(true);
  expect(app.shownMenus).toHaveLength(0);
  fire("pointerup", tab, 10, 10, 0);

  expect(app.shownMenus).toHaveLength(1);
  expect(app.menuLabels()[0]).toBe("Rename");
});

it("u2694e_a_right_drag_past_the_threshold_pulls_and_opens_no_menu", async () => {
  const { app } = await mountBubbles();
  const tab = document.querySelector(".terminal-tab-pair")!;

  rightPress(tab, 30);

  expect(app.shownMenus).toHaveLength(0);
});

// U2694f/g exercise the mounted App: row-only fixtures miss Ark activation and Bubble restoration.
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import { fakeEmulators } from "../terminal/paneHarness";

const mountApp = async (seed: SeedName = "tree-40") => {
  const controls = seedApp(seed, 0);
  const emulators = fakeEmulators();
  const view = render(() => <App app={controls.app} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} />);

  if (seed === "first-run") await screen.findByRole("button", { name: "Choose folder…" });
  else await screen.findByRole("tree");

  return { ...controls, ...view };
};

it.each(["first-run", "empty-project", "tree-40", "bubbles"] as const)("u2694f_contextmenu_is_cancelled_across_the_mounted_app: %s", async (seed) => {
  const { container } = await mountApp(seed);
  const targets = container.querySelectorAll(".rail, .rail-row, .trunks, .window-bar, .strip, .centre, .shelf, input, textarea, .pane-screen");
  expect(targets.length).toBeGreaterThan(0);

  for (const target of targets) {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented, `${seed}: ${target.className}`).toBe(true);
  }
});
