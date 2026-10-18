import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createToast, ToastProvider } from "./Toast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u492_hover_focus_restart_full_duration", async () => {
  vi.useFakeTimers();
  const toast = createToast({ limit: 3, newestFirst: true });
  render(() => <ToastProvider toast={toast} label="Updates" />);
  toast.show({ id: "agent", name: "Agent", content: "Needs you" });
  await vi.advanceTimersByTimeAsync(2000);
  const card = screen.getByRole("button", { name: "Agent Needs you" });
  fireEvent.pointerEnter(card);
  await vi.advanceTimersByTimeAsync(6000);
  fireEvent.pointerLeave(card);
  // Ark's public duration update enters visible:updating until its next frame.
  await vi.advanceTimersToNextFrame();
  await vi.advanceTimersByTimeAsync(1000);
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

it.each([["key", 0], ["pointer", 1]] as const)("u492_configurable_provider_lifecycle_%s", async (source, detail) => {
  vi.useFakeTimers();
  const activate = vi.fn();
  const toast = createToast({ limit: 3, newestFirst: true, onActivate: activate });
  render(() => <ToastProvider toast={toast} label="Updates" />);
  toast.show({ id: "a", name: "Old", content: "First" });
  toast.show({ id: "a", name: "Updated", content: "Changed" });
  await vi.advanceTimersToNextFrame();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Updated Changed" }), { detail });
  await vi.advanceTimersByTimeAsync(200);
  expect(activate).toHaveBeenCalledExactlyOnceWith("a", source);
  expect(screen.queryByText("Updated")).toBeNull();
});

