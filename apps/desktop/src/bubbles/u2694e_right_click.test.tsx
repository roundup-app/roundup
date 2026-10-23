// U2694f/g exercise the mounted App: row-only fixtures miss Ark activation and Bubble restoration.
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import { node, workstream, info } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";

import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { mountBubbles } from "./bubblesFixture";

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

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

const mountApp = async (seed: SeedName = "tree-40", rail = false) => {
  const controls = seedApp(seed, 0);

  if (rail) {
    controls.app.handlers["rail.tree"] = () => [workstream("w"), node("branch", { parent: "w" }), node("child", { parent: "branch" }), node("leaf", { parent: "w", order: 1 })];
    controls.app.handlers["terminal.list"] = () => [info("t-branch", { owner: "branch" }), info("t-child", { owner: "child" }), info("t-leaf", { owner: "leaf" })];
  }

  const emulators = fakeEmulators();
  const view = render(() => <App app={controls.app} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} />);

  if (seed === "first-run") await screen.findByRole("button", { name: "Choose folder…" });
  else await screen.findByRole("tree");

  if (rail) fireEvent.click(row("w"));

  return { ...controls, ...view, emulators };
};

it.each(["agent", "door", "bubble"] as const)("u3529a_terminal_selection_and_right_click_stay_in_the_terminal: %s", async (placement) => {
  const { app, emulators } = await mountApp("bubbles");
  if (placement === "bubble") fireEvent.click(document.querySelector(".terminal-new")!);
  else fireEvent.click(row(placement === "door" ? "first-workstream" : "runner"));
  await waitFor(() => expect([...emulators.made.values()].some(each => each.host?.isConnected)).toBe(true));
  const emulator = [...emulators.made.values()].find(each => each.host?.isConnected)!;
  const target = emulator.host!.firstElementChild!;
  const controls = () => [...document.querySelectorAll('[role="dialog"], input, textarea, button, [role="menu"]')];
  const before = controls();
  const calls = app.calls.length;
  const menus = app.shownMenus.length;
  const delivered: string[] = [];
  for (const type of ["mousedown", "mouseup"]) target.addEventListener(type, () => delivered.push(type));
  fireEvent.mouseDown(target, { button: 0 });
  emulator.select("exact é 🪁 output");
  fireEvent.mouseUp(target, { button: 0 });
  expect(controls().filter(each => !before.includes(each))).toEqual([]);
  delivered.length = 0;
  fire("pointerdown", target, 10, 10, 2);
  fire("mousedown", target, 10, 10, 2);
  expect(delivered).toEqual(["mousedown"]);
  expect(fire("contextmenu", target, 10, 10, 2).defaultPrevented).toBe(false);
  fire("pointerup", target, 10, 10, 0);
  fire("mouseup", target, 10, 10, 0);
  expect(delivered).toEqual(["mousedown", "mouseup"]);
  expect(controls().filter(each => !before.includes(each))).toEqual([]);
  expect(app.shownMenus).toHaveLength(menus);
  expect(app.calls.slice(calls).filter(call => ["message.send", "terminal.open", "terminal.write"].includes(call.method))).toEqual([]);
});

const row = (id: string) => document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;

const selected = () => document.querySelector(".rail-row[data-selected=true]")?.getAttribute("data-id");

const pane = () => [...document.querySelectorAll(".bubble")].map((bubble) => [bubble.getAttribute("data-bubble"), bubble.hasAttribute("hidden")]);

const branches = () => [...document.querySelectorAll("[role=treeitem][aria-expanded]")].map((branch) => [branch.getAttribute("data-id"), branch.getAttribute("aria-expanded")]);

const gesture = (target: Element, ctrl: boolean, early: boolean, distance = 0) => {
  const event = (type: string, buttons: number, x = 10, compatibility = false) => {
    const init = { bubbles: true, cancelable: true, button: compatibility || ctrl ? 0 : 2, buttons, ctrlKey: ctrl && !compatibility, clientX: x, clientY: 10 };

    const press = type.startsWith("pointer")
      ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true, pointerId: 1 })
      : new MouseEvent(type, init);

    target.dispatchEvent(press);

    return press;
  };

  const buttons = ctrl ? 1 : 2;
  event("pointerdown", buttons);
  event("mousedown", buttons);

  if (early) event("contextmenu", buttons);
  event("pointermove", buttons, 10 + distance);
  event("mousemove", buttons, 10 + distance);
  event("pointerup", 0, 10 + distance);
  event("mouseup", 0, 10 + distance);

  if (!early) event("contextmenu", 0, 10 + distance);

  if (ctrl) event("click", 0, 10 + distance, true);
};

const cases = [false, true].flatMap((ctrl) => [false, true].flatMap((early) => ["w", "branch", "leaf"].flatMap((id) => [false, true].map((isSelected) => ({ ctrl, early, id, isSelected, distance: ctrl && early ? 12 : 0 })))));

it.each(cases)("u2694g_context_click_requests_only_the_target_rows_menu: $ctrl $early $id $isSelected", async ({ ctrl, early, id, isSelected, distance }) => {
  const { app, emulators } = await mountApp("tree-40", true);
  const chosen = isSelected ? id : id === "w" ? "branch" : "w";
  fireEvent.click(row(chosen));

  if (chosen !== "w") {
    await waitFor(() => expect(emulators.made.has(`t-${chosen}`)).toBe(true));
  }

  await waitFor(() => expect(selected()).toBe(chosen));
  const beforePane = pane();
  const beforeBranches = branches();
  const calls = app.calls.length;

  gesture(row(id).querySelector(".name")!, ctrl, early, distance);

  expect(app.shownMenus).toHaveLength(1);
  await app.closeMenu();
  expect(selected()).toBe(chosen);
  expect(branches()).toEqual(beforeBranches);
  expect(pane()).toEqual(beforePane);
  expect(app.calls.slice(calls).filter((call) => /^(terminal\.(open|write)|agent\.(spawn|resume)|rail\.(move|startDoor)|message\.send)$/.test(call.method))).toEqual([]);
});

it("u2694g_dismissal_keeps_the_prior_selection_and_pane", async () => {
  const { app } = await mountApp("bubbles");
  fireEvent.click(row("runner"));
  const tab = await screen.findByRole("button", { name: "cargo test" });
  fireEvent.click(tab);
  fireEvent.click(await screen.findByRole("button", { name: "Minimise" }));
  const before = pane();
  expect(before.some(([, hidden]) => hidden)).toBe(true);
  gesture(row("first-workstream"), true, true);
  await app.closeMenu();
  expect(selected()).toBe("runner");
  expect(pane()).toEqual(before);
});

it("u2694g_the_chosen_action_uses_the_clicked_row", async () => {
  const { app } = await mountApp("tree-40", true);
  app.handlers["agent.stop"] = () => null;
  gesture(row("branch"), true, false);
  await app.pickMenu("Stop");
  expect(app.calls.filter((call) => call.method === "agent.stop")).toEqual([]);
  fireEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "agent.stop").map((call) => call.params)).toEqual([{ id: "branch" }]));
});

it("u2694f_suppressing_the_default_keeps_the_objects_native_menu", async () => {
  const { app } = await mountApp("tree-40", true);
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  row("branch").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(app.shownMenus).toHaveLength(1);
});

it("u2694f_empty_space_opens_no_menu_or_terminal", async () => {
  const { app, container } = await mountApp("tree-40", true);
  const before = pane();
  const calls = app.calls.length;

  for (const target of container.querySelectorAll(".rail, .centre, .strip")) gesture(target, false, false);
  expect(app.shownMenus).toHaveLength(0);
  expect(pane()).toEqual(before);
  expect(app.calls.slice(calls).filter((call) => call.method === "terminal.open")).toEqual([]);
});

it("u2694g_keyboard_disclosure_works_when_ctrl_click_has_no_compatibility_click", async () => {
  const { app } = await mountApp("tree-40", true);
  fireEvent.pointerDown(row("w"), { button: 0, ctrlKey: true });
  fireEvent.contextMenu(row("w"), { button: 0, ctrlKey: true });
  fireEvent.pointerUp(row("w"), { button: 0, ctrlKey: true });
  await app.closeMenu();
  const disclosure = row("w").querySelector<HTMLElement>(".rail-chevron")!;
  disclosure.focus();
  fireEvent.keyDown(disclosure, { key: " " });
  fireEvent.keyUp(disclosure, { key: " " });
  // The browser synthesises this click for Space, without another pointerdown.
  fireEvent.click(disclosure, { detail: 0 });
  expect(row("w").closest('[role="treeitem"]')?.getAttribute("aria-expanded")).toBe("false");
});
