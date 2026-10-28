import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountBubbles } from "./bubblesFixture";
import { clamped, placesStorage, resizedAbout, toggledFill, ZONES } from "./places";

let height = 600;

let barHeight = 40;

let layout = true;

const observers = new Map<ResizeObserver, { notify: ResizeObserverCallback; targets: Set<Element> }>();

const resized = (element: Element) => {
  for (const [observer, { notify, targets }] of observers) if (targets.has(element)) notify([], observer);
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  height = 600;
  barHeight = 40;
  layout = true;
  vi.stubGlobal("ResizeObserver", class {
    readonly targets = new Set<Element>();
    constructor(notify: ResizeObserverCallback) { observers.set(this, { notify, targets: this.targets }); }
    observe(element: Element) { this.targets.add(element); }
    unobserve(element: Element) { this.targets.delete(element); }
    disconnect() { this.targets.clear(); }
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (!layout) return new DOMRect();

    if (this.matches(".centre-stack")) return new DOMRect(0, 0, 800, height);

    if (this.matches(".resource-agent, .terminal-tabs")) return new DOMRect(0, height - barHeight, 800, barHeight);

    if (this.matches(".bubbles")) return new DOMRect(0, 0, 800, height - (parseFloat((this instanceof HTMLElement && this.style.bottom) || "0")));

    if (this.matches(".hint-line")) return new DOMRect(0, height - 80, 800, 24);

    if (this.matches(".thread-composer")) return new DOMRect(0, height - 112, 800, 72);

    if (this.matches(".resource-strip")) return this.childElementCount ? new DOMRect(0, height - 64, 800, 24) : new DOMRect();

    return new DOMRect();
  });
});

afterEach(() => { cleanup(); observers.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const stored = () => placesStorage("/p").read()["2"]!;

const bubble = () => document.querySelector<HTMLElement>('.bubble[data-bubble="2"]')!;

const header = () => bubble().querySelector<HTMLElement>(".bubble-header")!;

const frame = () => new Promise(requestAnimationFrame);

const bottom = () => parseFloat(bubble().style.top) + parseFloat(bubble().style.height);

const saved = { x: 200, y: 300, w: 300, h: 300, min: false };

it.each([40, 56])("u4459_no_move_resize_or_fill_reaches_the_bar_%s", async measuredHeight => {
  barHeight = measuredHeight;

  for (const route of ["move", "keys", "resize", "fill", "pull"]) {
    placesStorage("/p").write({ "2": { ...saved, y: 100 } });
    await mountBubbles("w");

    if (route === "fill") fireEvent.dblClick(header());
    else if (route === "keys") {
      header().focus();

      for (let i = 0; i < 80; i++) fireEvent.keyDown(header(), { key: "ArrowDown", shiftKey: true });
    } else {
      const target = route === "move" ? header() : route === "resize" ? document.querySelector('.bubble-zone[data-zone="se"][data-zone-of="2"]')! : document.body;
      const press = new MouseEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 300, button: route === "pull" ? 2 : 0, buttons: route === "pull" ? 2 : 1 });
      Object.defineProperty(press, "pointerType", { value: "mouse" });
      fireEvent(target, press);
      fireEvent(window, new MouseEvent("pointermove", { clientX: 400, clientY: 2000, buttons: route === "pull" ? 2 : 1 }));
      await frame(); // Bubble.drag and pulling apply their pending geometry in requestAnimationFrame.
      fireEvent(window, new MouseEvent("pointerup", { button: route === "pull" ? 2 : 0 }));
    }

    expect(bottom(), route).toBeLessThanOrEqual(600 - measuredHeight);
    expect(stored(), route).not.toMatchObject({ ...saved, y: 100 });
    cleanup();
  }
});

it("u4459_a_taller_bar_reclamps_open_bubbles", async () => {
  placesStorage("/p").write({ "2": saved, "1": { ...saved, min: true } });
  await mountBubbles("a");
  barHeight = 56;
  resized(document.querySelector(".resource-agent")!);

  for (const place of Object.values(placesStorage("/p").read())) expect(place.y + place.h).toBeLessThanOrEqual(544);
  height = 500;
  window.dispatchEvent(new Event("resize"));

  for (const place of Object.values(placesStorage("/p").read())) expect(place.y + place.h).toBeLessThanOrEqual(444);
});

it("u4459_a_saved_place_over_the_bar_reclamps_on_load", async () => {
  layout = false;
  placesStorage("/p").write({ "2": { ...saved, restore: { x: 200, y: 400, w: 300, h: 300 } } });
  await mountBubbles("w");
  expect(stored()).toMatchObject(saved);
  layout = true;
  resized(document.querySelector(".centre-stack")!);
  expect(stored().y + stored().h).toBe(560);
  const restored = toggledFill({ x: 16, y: 16, w: 768, h: 528, min: false, restore: { x: 200, y: 400, w: 300, h: 300 } }, { width: 800, height: 560 });
  expect(restored).toMatchObject({ y: 260, h: 300 });
  expect(restored.restore).toBeUndefined();
});

it.each([["hint-line", 80], ["resource-strip", 64], ["thread-composer", 112]] as const)("u4459_without_a_bar_the_next_sibling_edge_holds_%s", async (name, inset) => {
  const mounted = await mountBubbles("w");
  const stack = document.querySelector(".centre-stack")!;
  const hint = document.createElement("div");
  hint.className = name;
  hint.append(document.createElement("button"));
  stack.append(hint);
  mounted.setHostPresent(false);
  await waitFor(() => expect(document.querySelector<HTMLElement>(".bubbles")!.style.bottom).toBe(`${inset}px`));
  hint.remove();
  await waitFor(() => expect(document.querySelector<HTMLElement>(".bubbles")!.style.bottom).toBe("0px"));
});

it("u4459_the_clamp_seam_holds_for_every_zone_and_delta", () => {
  const extent = { width: 800, height: 544 };

  for (const zone of ZONES) for (const dx of [-10000, -400, 0, 400, 10000]) for (const dy of [-10000, -400, 0, 400, 10000]) {
    for (const result of [clamped({ ...saved, x: dx, y: dy }, extent), resizedAbout(saved, zone, dx, dy, extent)]) {
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.y + result.h).toBeLessThanOrEqual(544);
    }
  }
});
