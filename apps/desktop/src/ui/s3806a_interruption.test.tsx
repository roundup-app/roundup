import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { bubbleCalls, mountBubbles } from "../bubbles/bubblesFixture";
import { placesStorage } from "../bubbles/places";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  placesStorage("/p").write({ "2": { x: 200, y: 100, w: 300, h: 300, min: false } });
});
afterEach(cleanup);

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const move = () => fireEvent(window, new MouseEvent("pointermove", { clientX: 440, clientY: 340 }));

it.each(["window-blur"])("s3806a_interruption_settles_the_gesture Bubble move %s", async () => {
  const mounted = await mountBubbles("w");
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="2"]')).not.toBeNull());
  const header = document.querySelector<HTMLElement>('.bubble[data-bubble="2"] .bubble-header')!;
  const before = placesStorage("/p").read()["2"];
  fireEvent.pointerDown(header, { button: 0, clientX: 400, clientY: 300 });
  move();
  window.dispatchEvent(new Event("blur"));
  move();
  fireEvent(window, new MouseEvent("pointerup"));
  await frame();
  expect(placesStorage("/p").read()["2"]).toEqual(before);
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  fireEvent.pointerDown(header, { button: 0, clientX: 400, clientY: 300 });
  move();
  fireEvent(window, new MouseEvent("pointerup"));
  expect(placesStorage("/p").read()["2"]).toMatchObject({ x: 240, y: 140 });
});
