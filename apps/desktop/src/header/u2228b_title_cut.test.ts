import { afterEach, expect, it, vi } from "vitest";
import { middleCut } from "./middleCut";

afterEach(() => vi.restoreAllMocks());

/** jsdom has no layout: one character is one unit wide, the box holds `room`. */
const box = (room: number) => {
  const el = document.createElement("div");
  vi.spyOn(el, "scrollWidth", "get").mockImplementation(() => el.textContent!.length);
  vi.spyOn(el, "clientWidth", "get").mockReturnValue(room);

  return el;
};

it("u2228b_a_long_title_keeps_start_and_end", () => {
  const el = box(30);
  const text = `Payments — ${"x".repeat(290)}END`;
  middleCut(el, text);

  expect(el.textContent!.length).toBe(30);
  expect(el.textContent!.startsWith("Payments")).toBe(true);
  expect(el.textContent!.endsWith("xxEND")).toBe(true);
  expect(el.textContent!.split("…")).toHaveLength(2);
  expect(el.textContent!.endsWith("…")).toBe(false);
});

it("u2228b_a_short_title_is_whole", () => {
  const el = box(30);
  middleCut(el, "api — Build");

  expect(el.textContent).toBe("api — Build");
});

it("u2228b_resize_recuts_the_title", () => {
  const el = box(20);
  const text = "a".repeat(60);
  middleCut(el, text);
  expect(el.textContent!.length).toBe(20);

  vi.spyOn(el, "clientWidth", "get").mockReturnValue(40);
  middleCut(el, text);
  expect(el.textContent!.length).toBe(40);
});
