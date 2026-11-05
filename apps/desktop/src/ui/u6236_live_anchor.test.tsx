import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Tip } from "./Tip";
import { anchorBox } from "./anchorBox";

afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility"); cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** A browser gives a live node its box and a detached node zero. */
const browserBoxes = () => {
  const read: Element[] = [];

  // jsdom has no layout; a browser reports a connected element with a box as visible.
  Object.defineProperty(HTMLElement.prototype, "checkVisibility", { configurable: true, value() { return this.isConnected; } });

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    read.push(this);

    return this.isConnected ? new DOMRect(100, 100, 40, 40) : new DOMRect(0, 0, 0, 0);
  });

  return read;
};

it("u6236a_replaced_trigger_keeps_the_tooltip_on_its_trigger", async () => {
  vi.useFakeTimers({ toFake: ["queueMicrotask", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  const read = browserBoxes();
  const [generation, setGeneration] = createSignal<number | null>(1);

  render(() => <Tip text="Explain">{trigger => <Show when={generation()} keyed>{each => <button data-generation={each} {...trigger()}>Owner</button>}</Show>}</Tip>);
  const first = screen.getByRole("button");

  fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 110, clientY: 110 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await screen.findByRole("tooltip")).toBeTruthy();

  setGeneration(2);
  await vi.advanceTimersByTimeAsync(100);
  const replacement = screen.getByRole("button");

  expect(replacement).not.toBe(first);
  read.length = 0;
  window.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(100);
  expect(read.length > 0 && read.every(element => element.isConnected)).toBe(true);
  expect(screen.queryByRole("tooltip")).toBeTruthy();

  setGeneration(null);
  await vi.advanceTimersByTimeAsync(100);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("u6236b_replaced_row_keeps_the_picker_on_its_row", () => {
  browserBoxes();
  const old = document.body.appendChild(document.createElement("button"));
  const replacement = document.createElement("button");

  expect(anchorBox(old)?.width).toBe(40);
  old.remove();
  expect(anchorBox(old)).toBeNull();
  document.body.appendChild(replacement);
  expect(anchorBox(old, () => replacement)?.width).toBe(40);
  replacement.remove();
  expect(anchorBox(old, () => replacement)).toBeNull();
  expect(anchorBox(old, () => null)).toBeNull();
});
