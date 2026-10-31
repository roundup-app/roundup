import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agent, USER } from "../testing/nodes";
import { TOAST_AGENT as AGENT, by, mountToasts, status, toastTodo as todo } from "./toastFixture";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
};

it("u503_shared_toast_preserves_lifecycle", async () => {
  const { app, toasts, sounds, connected, shown } = await mountToasts([agent("a", "working", "x", { name: "scout" }), agent("b", "working", "x", { name: "mason" })], { todos: [] });

  app.emit(status("a", "needs-you"));
  await settle();

  const card = screen.getByRole("button", { name: "scout: Needs you" });

  // Hover and focus hold the time; leaving resumes from what was left, not from five seconds.
  await vi.advanceTimersByTimeAsync(3000);
  fireEvent.mouseEnter(screen.getByRole("region"));
  card.focus();
  await vi.advanceTimersByTimeAsync(8000);
  fireEvent.mouseLeave(screen.getByRole("region"));
  await vi.advanceTimersByTimeAsync(8000);
  expect(toasts()).toHaveLength(1);
  card.blur();
  await vi.advanceTimersByTimeAsync(1900);
  expect(toasts()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(400);
  await settle();
  expect(toasts()).toHaveLength(0);

  // Activation navigates once and dismisses; a missing target shows the visible failure.
  app.emit(status("b", "error"));
  await settle();
  fireEvent.click(toasts()[0]!);
  await settle();
  expect(connected.rail.selected()).toBe("b");
  expect(shown).toEqual(["/p"]);
  await vi.advanceTimersByTimeAsync(200);
  expect(toasts()).toHaveLength(0);

  app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER) }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: 'scout: Changed Todo "ship it"' }));
  await settle();
  expect(screen.getByRole("alert").textContent).not.toBe("");

  // Escape dismisses without activating; one chime served each distinct burst.
  app.emit(status("a", "error"));
  await settle();
  fireEvent.keyDown(toasts()[0]!, { key: "Escape" });
  await vi.advanceTimersByTimeAsync(200);
  expect(toasts()).toHaveLength(0);
  expect(connected.rail.selected()).toBe("b");
  expect(sounds.length).toBeGreaterThan(0);
});

it("u503_shared_toast_idle_runs_nothing", async () => {
  const { app, toasts, sounds, view } = await mountToasts([agent("a", "working", "x", { name: "scout" })]);

  await settle();
  expect(toasts()).toHaveLength(0);
  expect(view.container.querySelector(".app-toast")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);

  app.emit(status("a", "needs-you"));
  await settle();
  fireEvent.keyDown(toasts()[0]!, { key: "Escape" });
  await vi.advanceTimersByTimeAsync(400);
  await settle();
  expect(view.container.querySelector(".app-toast")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  expect(sounds).toHaveLength(1);
});
