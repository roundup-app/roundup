import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { placesStorage } from "./places";
import { bubbleCalls, bubbleNames, mountBubbles } from "./bubblesFixture";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Pull keeps using a deliberate saved rectangle; U2742's rendered observer owns the fresh default.
  placesStorage("/p").write({
    "1": { x: 16, y: 16, w: 600, h: 300, min: true },
    "2": { x: 32, y: 32, w: 600, h: 300, min: false },
    "3": { x: 48, y: 48, w: 600, h: 300, min: false },
  });
});

afterEach(cleanup);

const bubble = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.bubble[data-bubble="${id}"]`)!;

type Mouse = { x: number; y: number; button?: number; buttons?: number; pointerType?: string } & MouseEventInit;

const fire = (type: string, target: Element | Window, init: Mouse): Event => {
  const { x, y, pointerType = "mouse", ...rest } = init;
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...rest });

  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);

  return event;
};


const press = (target: Element | Window, x: number, y: number, init: Partial<Mouse> = {}) => fire("pointerdown", target, { x, y, button: 2, buttons: 2, ...init });

const drag = (to: { x: number; y: number }, target: Element | Window = window) => fire("pointermove", target, { ...to, button: -1, buttons: 2 });

const release = (x: number, y: number, target: Element | Window = window) => fire("pointerup", target, { x, y, button: 2, buttons: 0 });

const menu = (target: Element | Window = window) => fire("contextmenu", target, { x: 0, y: 0, button: 2 });

const left = (id: string): number => parseFloat(bubble(id).style.left);

const top = (id: string): number => parseFloat(bubble(id).style.top);

const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));

const ready = async (selected: string | null = "a") => {
  const mounted = await mountBubbles(selected);

  if (selected !== null) await waitFor(() => expect(bubble("1")).not.toBeNull());

  return mounted;
};

describe("u421 a right-button drag pulls a bubble out", () => {
  it("u421_a_right_drag_of_8_px_starts_a_pull_and_7_does_not", async () => {
    await ready();
    const before = left("2");

    press(document.body, 400, 300);
    drag({ x: 407, y: 300 });
    await frame();
    expect(left("2")).toBe(before);

    drag({ x: 408, y: 300 });
    await frame();
    expect(left("2")).toBe(108);
    expect(before).not.toBe(108);
    release(408, 300);
    expect(menu().defaultPrevented).toBe(true);
  });

  it("u421_left_touch_pen_and_modified_presses_start_no_pull", async () => {
    await ready();
    const before = left("2");
    const cases: Partial<Mouse>[] = [{ button: 0, buttons: 1 }, { pointerType: "touch" }, { pointerType: "pen" }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }];

    for (const init of cases) {
      press(document.body, 400, 300, init);
      drag({ x: 500, y: 400 });
      await frame();
      release(500, 400);
      expect(left("2")).toBe(before);
      expect(menu().defaultPrevented).toBe(false);
    }
  });

  it("u421_a_pull_starts_over_app_chrome", async () => {
    await ready();

    for (const target of [document.body, bubble("2").querySelector(".bubble-header")!, document.querySelector(".centre-stack")!]) {
      press(target, 400, 300);
      drag({ x: 450, y: 340 }, target);
      await frame();
      expect(left("2")).toBe(150);
      release(450, 340, target);
      menu(target);
    }
  });

  it("u421_the_pull_takes_the_last_focused_bubble_else_the_latest", async () => {
    await ready();
    press(document.body, 400, 300);
    drag({ x: 500, y: 300 });
    await frame();
    release(500, 300);
    expect(left("2")).toBe(200);
    expect(left("1")).not.toBe(200);

    document.querySelector<HTMLElement>('.terminal-tab[data-bubble="1"]')!.focus();
    press(document.body, 400, 300);
    drag({ x: 500, y: 300 });
    await frame();
    release(500, 300);
    expect(left("1")).toBe(200);
  });

  it("u421_a_minimised_bubble_is_restored_by_the_pull", async () => {
    await ready();
    bubble("2").querySelector<HTMLElement>("[aria-label=Minimise]")!.click();
    await waitFor(() => expect(bubble("2").hidden).toBe(true));
    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    await frame();
    expect(bubble("2").hidden).toBe(false);
    expect(document.querySelectorAll(".bubble:not([hidden])")).toHaveLength(1);
    expect(document.querySelectorAll(".terminal-tab")).toHaveLength(2);
    expect(left("2")).toBe(150);
  });

  it("u421_a_workstream_with_no_terminal_opens_one_with_one_call", async () => {
    const mounted = await mountBubbles("other");

    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    drag({ x: 480, y: 120 });
    await waitFor(() => expect(bubbleNames()).toContain("login"));
    drag({ x: 500, y: 130 });
    await frame();
    await frame();
    expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([{ workstream: "other" }]);
    expect(bubble("9").hidden).toBe(false);
    release(500, 130);
    expect(bubbleCalls(mounted.app, "terminal.open")).toHaveLength(1);
  });

  it("u421_a_failed_open_shows_the_failure_line_and_opens_nothing", async () => {
    const mounted = await mountBubbles("other");

    mounted.app.handlers["terminal.open"] = () => {
      throw new Error("no shell");
    };

    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("no shell"));
    expect(bubbleNames()).toEqual([]);
  });

  it("u421_the_bubble_follows_the_pointer_and_stays_where_it_is_released", async () => {
    await ready();
    const width = bubble("2").style.width;

    press(document.body, 400, 300);
    drag({ x: 450, y: 120 });
    await frame();
    expect([left("2"), top("2")]).toEqual([150, 120]);
    drag({ x: 500, y: 140 });
    release(500, 140);
    expect([left("2"), top("2")]).toEqual([200, 140]);
    expect(bubble("2").style.width).toBe(width);
    expect(JSON.parse(window.sessionStorage.getItem("roundup:bubble-places:/p")!)["2"].x).toBe(200);
  });

  it("u421_the_bubble_stays_inside_the_pane_when_the_pointer_leaves_it", async () => {
    await ready();
    press(document.body, 400, 300);
    drag({ x: 5000, y: 5000 });
    release(5000, 5000);
    expect([left("2"), top("2")]).toEqual([200, 300]);
    press(document.body, 400, 300);
    drag({ x: -500, y: -500 });
    release(-500, -500);
    expect([left("2"), top("2")]).toEqual([0, 0]);
  });

  it("u421_a_pull_moves_no_selection_and_writes_nothing_to_the_terminal", async () => {
    const mounted = await ready();

    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    release(450, 300);
    expect(mounted.connected.rail.selected()).toBe("a");
    expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  });

  it("u421_a_pull_hides_its_moves_from_the_page_below", async () => {
    await ready();
    let heard = 0;
    const count = () => heard++;

    document.body.addEventListener("pointermove", count);
    press(document.body, 400, 300);
    drag({ x: 450, y: 300 }, document.body);
    expect(heard).toBe(0);
    release(450, 300);
    document.body.removeEventListener("pointermove", count);
  });

  it("u421_esc_ends_the_pull_in_place", async () => {
    await ready();
    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    await frame();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    drag({ x: 600, y: 400 });
    await frame();
    expect(left("2")).toBe(150);
    release(600, 400);
    expect(menu().defaultPrevented).toBe(true);
  });

  it("u421_a_pulled_place_survives_a_reload_and_is_forgotten_at_daemon_exited", async () => {
    await ready();

    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    release(450, 300);
    cleanup();
    await mountBubbles("a");
    await waitFor(() => expect(left("2")).toBe(150));
    cleanup();
    const exited = await mountBubbles("a");

    exited.setExit({ code: 1 });
    await waitFor(() => expect(window.sessionStorage.getItem("roundup:bubble-places:/p")).toBeNull());
  });

  it("u421_a_plain_right_click_on_a_rail_row_still_opens_the_menu", async () => {
    await ready();
    press(document.body, 400, 300);
    drag({ x: 404, y: 303 });
    release(404, 303);
    expect(menu().defaultPrevented).toBe(false);
  });

  it("u421_the_release_of_a_pull_opens_no_menu", async () => {
    await ready();
    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    drag({ x: 401, y: 300 });
    release(401, 300);
    expect(menu().defaultPrevented).toBe(true);
    expect(menu().defaultPrevented).toBe(false);
  });

  it("u421_with_no_workstream_selected_a_right_drag_does_nothing", async () => {
    const mounted = await mountBubbles(null);

    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    release(450, 300);
    expect(menu().defaultPrevented).toBe(false);
    expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([]);
  });

  it("u421_a_pull_during_an_open_call_or_after_daemon_exited_does_nothing", async () => {
    const mounted = await ready();

    mounted.setExit({ code: 1 });
    await waitFor(() => expect(window.sessionStorage.getItem("roundup:bubble-places:/p")).toBeNull());
    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    release(450, 300);
    expect(menu().defaultPrevented).toBe(false);
  });

  it("u421_an_open_rail_menu_closes_on_the_press_and_starts_no_pull", async () => {
    await ready();
    const open = document.createElement("div");

    open.setAttribute("role", "menu");
    document.body.append(open);
    press(document.body, 400, 300);
    drag({ x: 450, y: 300 });
    release(450, 300);
    open.remove();
    expect(menu().defaultPrevented).toBe(false);
  });
});


it("u469_pull_restores_only_its_target_and_keeps_all_tabs", async () => {
  const mounted = await ready();

  document.querySelector<HTMLElement>('.terminal-tab[data-bubble="1"]')!.focus();
  press(document.body, 400, 300);
  drag({ x: 450, y: 300 });
  await frame();
  release(450, 300);
  expect([...document.querySelectorAll('.bubble:not([hidden])')].map(element => element.getAttribute("data-bubble"))).toEqual(["1"]);
  expect(document.querySelectorAll('.terminal-tab')).toHaveLength(2);
  expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([]);
});
