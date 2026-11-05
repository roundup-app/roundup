import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Tip } from "./Tip";
import { agent, event } from "../testing/nodes";
import { mountTodos, todo } from "../todos/testHarness";

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

it("u6236b_removed_row_closes_the_owner_picker", async () => {
  const { app, store } = await mountTodos([todo(1, { title: "Ship the login fix" })], true, [agent("a", "idle", "A", { name: "alpha" })]);
  const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 Ship the login fix/ });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });
  expect(await screen.findByRole("menu")).toBeTruthy();

  store.todos = [];
  app.emit(event({ name: "todo.deleted", data: { id: 1 } }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
