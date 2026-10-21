import { cleanup } from "@solidjs/testing-library";
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
