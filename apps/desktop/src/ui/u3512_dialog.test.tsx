import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { gate } from "../testing/appFixture";
import { mountTodos, todo } from "../todos/testHarness";

const animations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();

  if (animations) Object.defineProperty(Element.prototype, "getAnimations", animations);
  else Reflect.deleteProperty(Element.prototype, "getAnimations");
});

it("u3512d_reopen_owns_exit_completion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { app } = await mountTodos([todo(1)], false);
  const exit = gate<void>();
  const opening = gate<void>();
  let finished = opening.promise;

  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [{ finished }] });
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });

  const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / });

  const open = async () => {
    row.focus();
    fireEvent.keyDown(row, { key: "o", code: "KeyO" });
    const menu = await screen.findByRole("menu", { name: "Owners for #1" });
    fireEvent.pointerDown(within(menu).getByText("New Workstream…"), { pointerType: "mouse", button: 0 });
    fireEvent.click(within(menu).getByText("New Workstream…"), { detail: 1 });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "New Workstream" })).toHaveProperty("inert", false));

    return screen.getByRole("dialog", { name: "New Workstream" });
  };

  const original = await open();
  // Dialog's createSlideLifetime observes browser animations on the next frame.
  vi.advanceTimersToNextFrame();
  opening.resolve();
  await opening.promise;
  await Promise.resolve();

  finished = exit.promise;
  const cancel = within(original).getByRole("button", { name: "Dismiss" });
  fireEvent.pointerDown(cancel, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(cancel, { button: 0 });
  fireEvent.click(cancel, { detail: 1 });
  await waitFor(() => expect(original).toHaveProperty("inert", true));
  vi.advanceTimersToNextFrame();
  expect(original.isConnected).toBe(true);
  expect(original).toHaveProperty("inert", true);

  finished = new Promise(() => {});
  const reopened = await open();
  vi.advanceTimersToNextFrame();
  const field = within(reopened).getByRole("textbox", { name: "Workstream name" });
  fireEvent.input(field, { target: { value: "latest 雪 é" } });
  exit.resolve();
  await Promise.allSettled([exit.promise, exit.promise]);
  await Promise.resolve();

  expect(screen.getByRole("dialog", { name: "New Workstream" })).toBe(reopened);
  expect(reopened).toHaveProperty("inert", false);
  expect(within(reopened).getByRole<HTMLTextAreaElement>("textbox", { name: "Workstream name" }).value).toBe("latest 雪 é");
  expect(app.calls.filter(call => call.method === "todo.startWorkstream")).toEqual([]);
});
