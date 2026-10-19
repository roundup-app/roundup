import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bubbleCalls, mountBubbles } from "./bubblesFixture";
import { MIN_HEIGHT, MIN_WIDTH, placesStorage, resizedAbout, toggledFill, ZONES } from "./places";
import type { Extent, Place } from "./places";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

const bubble = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.bubble[data-bubble="${id}"]`)!;

const zone = (name: string): HTMLElement => document.querySelector<HTMLElement>(`.bubble-zone[data-zone="${name}"][data-zone-of="2"]`)!;

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const num = (value: string) => parseFloat(value);

const geometry = (id = "2") => ({ x: num(bubble(id).style.left), y: num(bubble(id).style.top), w: num(bubble(id).style.width), h: num(bubble(id).style.height) });

const shown = async (centred = false) => {
  if (centred) placesStorage("/p").write({ "2": { x: 250, y: 150, w: 300, h: 300, min: false } });

  const mounted = await mountBubbles("w");
  await waitFor(() => expect(bubble("2")).not.toBeNull());
  await waitFor(() => expect(bubble("2").hidden).toBe(false));

  return mounted;
};

const drag = async (name: string, dx: number, dy: number) => {
  fireEvent.pointerDown(zone(name), { button: 0, clientX: 500, clientY: 400 });
  fireEvent(window, new MouseEvent("pointermove", { clientX: 500 + dx, clientY: 400 + dy }));
  await frame();
  fireEvent(window, new MouseEvent("pointerup"));
};

const FALLBACK_EXTENT: Extent = { width: 800, height: 600 };

describe("u2236 any edge or corner resizes the bubble", () => {
  it("u2236_each_edge_and_corner_resizes_about_the_centre", async () => {
    await shown(true);

    for (const { name, sx, sy } of ZONES) {
      const before = geometry();

      await drag(name, 40 * sx, 40 * sy);

      const after = geometry();

      expect(after.w - before.w).toBe(80 * Math.abs(sx));
      expect(after.h - before.h).toBe(80 * Math.abs(sy));
      expect(Math.abs(after.x + after.w / 2 - (before.x + before.w / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(after.y + after.h / 2 - (before.y + before.h / 2))).toBeLessThanOrEqual(1);
      await drag(name, -40 * sx, -40 * sy);
    }
  });

  it("u2236_escape_restores_the_place_it_began_with", async () => {
    await shown();

    const before = geometry();

    fireEvent.pointerDown(zone("e"), { button: 0, clientX: 500, clientY: 400 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 520, clientY: 400 }));
    await frame();
    expect(geometry().w).toBe(before.w + 40);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(geometry()).toEqual(before);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 560, clientY: 400 }));
    await frame();
    expect(geometry()).toEqual(before);
  });

  it("u2236_a_drag_writes_style_once_per_frame", async () => {
    await shown();

    let writes = 0;
    const watched = new MutationObserver(() => { writes += 1; });

    watched.observe(bubble("2"), { attributes: true, attributeFilter: ["style"] });
    fireEvent.pointerDown(zone("e"), { button: 0, clientX: 500, clientY: 400 });

    for (let at = 1; at <= 10; at++) fireEvent(window, new MouseEvent("pointermove", { clientX: 500 + at, clientY: 400 }));

    await frame();
    await frame();
    fireEvent(window, new MouseEvent("pointerup"));
    watched.disconnect();
    expect(writes).toBe(1);
  });

  it("u2236_a_drag_stops_at_the_minimum_and_the_pane", async () => {
    await shown();
    await drag("se", -100000, -100000);
    expect(geometry()).toMatchObject({ w: MIN_WIDTH, h: MIN_HEIGHT });
    await drag("nw", 100000, 100000);
    expect(geometry()).toMatchObject({ w: MIN_WIDTH, h: MIN_HEIGHT });
    await drag("e", 100000, 0);

    const grown = geometry();

    expect(grown.x).toBeGreaterThanOrEqual(0);
    expect(grown.x + grown.w).toBeLessThanOrEqual(800);
    expect(grown.w).toBe(800);
    expect(resizedAbout({ x: 500, y: 0, w: 300, h: 100, min: false }, { sx: 1, sy: 0 }, 50, 0, FALLBACK_EXTENT)).toMatchObject({ x: 400, w: 400 });
  });

  it("u2236_the_zones_are_hidden_from_the_keyboard_and_assistive_tech", async () => {
    await shown();

    for (const { name } of ZONES) {
      expect(zone(name).getAttribute("aria-hidden")).toBe("true");
      expect(zone(name).hasAttribute("tabindex")).toBe(false);
      expect(zone(name).textContent).toBe("");
    }
  });

  it("u2236_a_resize_calls_terminal_resize_once_per_size_change", async () => {
    const mounted = await shown();

    await frame();
    await frame();

    const before = bubbleCalls(mounted.app, "terminal.resize").length;

    await drag("e", 0, 0);
    await frame();
    expect(bubbleCalls(mounted.app, "terminal.resize").length).toBe(before);
  });

  it("u2236_the_size_survives_a_reload_per_project", async () => {
    await shown();
    await drag("e", 20, 0);

    const size = geometry();

    expect(placesStorage("/p").read()["2"]).toMatchObject({ w: size.w, h: size.h });
    expect(placesStorage("/other").read()).toEqual({});
    cleanup();
    await shown();
    expect(geometry()).toMatchObject({ w: size.w, h: size.h });
  });

  it("u2236_daemon_exited_forgets_the_size", async () => {
    const mounted = await shown();

    await drag("e", 20, 0);
    mounted.setExit({ code: 1 });
    await waitFor(() => expect(placesStorage("/p").read()).toEqual({}));
  });

  it("u2236_a_resize_is_not_a_move_a_write_or_a_selection_change", async () => {
    const mounted = await shown();
    const before = geometry();

    await drag("n", 0, 20);
    expect(geometry().y + geometry().h / 2).toBeCloseTo(before.y + before.h / 2, 0);
    expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  });
});

describe("u2237 double-clicking the header fills the pane and restores", () => {
  const header = () => bubble("2").querySelector(".bubble-header")!;

  it("u2237_a_double_click_on_the_header_fills_the_pane", async () => {
    await shown();

    const before = geometry();

    fireEvent.dblClick(header());
    expect(geometry()).toEqual({ x: 16, y: 16, w: 768, h: 568 });
    expect(placesStorage("/p").read()["2"]?.restore).toEqual(before);
  });

  it("u2237_a_second_double_click_restores_the_last_size", async () => {
    await shown();

    const before = geometry();

    fireEvent.dblClick(header());
    fireEvent.dblClick(header());
    expect(geometry()).toEqual(before);
    expect(placesStorage("/p").read()["2"]?.restore).toBeUndefined();
  });

  it("u2237_a_resize_of_a_filled_bubble_keeps_the_restore_size", async () => {
    await shown();

    const before = geometry();

    fireEvent.dblClick(header());
    await drag("e", -20, 0);
    expect(placesStorage("/p").read()["2"]?.restore).toEqual(before);
    expect(geometry().w).toBe(728);

    const place: Place = { x: 16, y: 16, w: 768, h: 568, min: false, restore: { x: 5, y: 5, w: 300, h: 200 } };

    expect(toggledFill(place, { width: 800, height: 600 })).toEqual({ x: 5, y: 5, w: 300, h: 200, min: false });
  });

  it("u2237_a_filled_bubble_survives_a_reload", async () => {
    await shown();
    fireEvent.dblClick(header());
    cleanup();
    await shown();
    expect(geometry()).toEqual({ x: 16, y: 16, w: 768, h: 568 });
    expect(placesStorage("/p").read()["2"]?.restore).toBeDefined();
  });

  it("u2237_a_single_click_a_drag_and_the_rename_are_unchanged", async () => {
    await shown();

    const before = geometry();

    fireEvent.click(header());
    expect(geometry()).toEqual(before);

    fireEvent.pointerDown(header(), { button: 0, clientX: 500, clientY: 400 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 520, clientY: 410 }));
    await frame();
    fireEvent(window, new MouseEvent("pointerup"));
    expect(geometry()).toMatchObject({ x: before.x + 20, y: before.y + 10, w: before.w, h: before.h });

    fireEvent.dblClick(document.querySelector('.terminal-tab[data-bubble="2"] .terminal-tab-name')!);
    await waitFor(() => expect(document.querySelector(".terminal-tab-editor input")).not.toBeNull());
  });
});
