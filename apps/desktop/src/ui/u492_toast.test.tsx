import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createToast, ToastProvider } from "./Toast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u492_five_second_expiry", async () => {
  vi.useFakeTimers();
  const toast = createToast({ limit: 3, newestFirst: true });
  render(() => <ToastProvider toast={toast} label="Updates" />);
  toast.show({ id: "one", name: "Agent", content: "Needs you" });
  await vi.advanceTimersByTimeAsync(4999);
  expect(screen.getByRole("status").dataset.state).toBe("open");
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByRole("status").dataset.state).toBe("closed");
  await vi.advanceTimersByTimeAsync(200);
  expect(screen.queryByRole("status")).toBeNull();
});

it.each(["empty", "immediate", "hovered", "focused", "exiting"])("u492_idle_and_disposal_run_nothing_%s", async (state) => {
  vi.useFakeTimers();
  const dismissed = vi.fn();
  const toast = createToast({ limit: 3, newestFirst: true, onDismiss: dismissed });
  const view = render(() => <ToastProvider toast={toast} label="Updates" />);

  if (state === "empty") {
    expect(document.querySelector('[data-scope="toast"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } else {
    toast.show({ id: "one", name: "Agent", content: "Needs you" });

    if (state === "hovered" || state === "focused") await vi.advanceTimersToNextFrame();

    if (state === "hovered") fireEvent.pointerEnter(screen.getByRole("button"));

    if (state === "focused") fireEvent.focusIn(screen.getByRole("button"));

    if (state === "exiting") toast.dismiss("one");
  }

  view.unmount();
  const calls = dismissed.mock.calls.length;
  expect(document.querySelector('[data-scope="toast"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10000);
  expect(dismissed).toHaveBeenCalledTimes(calls);
  expect(document.querySelector('[data-scope="toast"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("u492_configured_limit_never_replays_evicted_cards", async () => {
  vi.useFakeTimers();
  const toast = createToast({ limit: 3, newestFirst: true });
  render(() => <ToastProvider toast={toast} label="Updates" />);

  for (const id of ["old", "a", "b", "summary"]) toast.show({ id, name: id, content: "Changed", duration: Infinity });
  await vi.advanceTimersByTimeAsync(200);
  screen.getByRole<HTMLButtonElement>("button").focus();
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["summary Changed", "b Changed", "a Changed"]);

  for (const id of ["a", "b", "summary"]) toast.dismiss(id);
  await vi.advanceTimersByTimeAsync(10000);
  expect(document.querySelector('[data-scope="toast"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
