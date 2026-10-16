import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u492_hover_focus_restart_full_duration", async () => {
  vi.useFakeTimers();
  render(() => <ToastProvider cards={[{ id: "agent", name: "Agent", content: "Needs you" }]} />);
  await vi.advanceTimersByTimeAsync(2000);
  const card = screen.getByRole("button", { name: "Agent Needs you" });
  fireEvent.pointerEnter(card);
  fireEvent.focusIn(card);
  await vi.advanceTimersByTimeAsync(6000);
  fireEvent.pointerLeave(card);
  await vi.advanceTimersByTimeAsync(6000);
  expect(screen.queryByText("Agent")).not.toBeNull();
  fireEvent.focusOut(card);
  await vi.advanceTimersToNextFrame();
  await vi.advanceTimersByTimeAsync(4999);
  expect(screen.queryByText("Agent")).not.toBeNull();
  await vi.advanceTimersToNextFrame();
  await vi.advanceTimersByTimeAsync(200);
  expect(screen.queryByText("Agent")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("u492_configurable_provider_lifecycle", async () => {
  vi.useFakeTimers();
  const activate = vi.fn();
  const [cards, setCards] = createSignal([{ id: "a", name: "Old", content: "First" }]);
  render(() => <ToastProvider cards={cards()} limit={3} onActivate={activate} />);
  setCards([{ id: "a", name: "Updated", content: "Changed" }]);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Updated Changed" }));
  await vi.advanceTimersByTimeAsync(200);
  expect(activate).toHaveBeenCalledExactlyOnceWith("a");
  expect(screen.queryByText("Updated")).toBeNull();
});
