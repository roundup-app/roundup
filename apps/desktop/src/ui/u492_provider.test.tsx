import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createToast, ToastProvider } from "./Toast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u492_hover_focus_resume_from_time_left", async () => {
  vi.useFakeTimers();
  const toast = createToast({ limit: 3, newestFirst: true });
  render(() => <ToastProvider toast={toast} label="Updates" />);
  toast.show({ id: "agent", name: "Agent", content: "Needs you" });
  await vi.advanceTimersByTimeAsync(2000);
  const card = screen.getByRole("button", { name: "Agent Needs you" });
  fireEvent.mouseEnter(screen.getByRole("region"));
  card.focus();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(screen.queryByText("Agent")).not.toBeNull();
  fireEvent.mouseLeave(screen.getByRole("region"));
  card.blur();
  await vi.advanceTimersByTimeAsync(2900);
  expect(screen.queryByText("Agent")).not.toBeNull();
  await vi.advanceTimersByTimeAsync(100 + 200);
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

