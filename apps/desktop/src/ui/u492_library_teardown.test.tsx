import { createToaster, Toaster, Toast } from "@ark-ui/solid/toast";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("u492_immediate_disposal_cancels_library_frames", async () => {
  vi.useFakeTimers();
  const status = vi.fn();
  const observe = vi.spyOn(MutationObserver.prototype, "observe");
  const toaster = createToaster({ placement: "bottom-end" });
  const mounted = render(() => <Toaster toaster={toaster}>
    {(toast) => <Toast.Root><Toast.Title>{toast().title}</Toast.Title></Toast.Root>}
  </Toaster>);
  toaster.create({ title: "Saved", duration: 5000, onStatusChange: status });
  expect(screen.getByText("Saved")).toBeDefined();
  mounted.unmount();
  const calls = status.mock.calls.length;
  const observations = observe.mock.calls.length;
  expect(document.querySelector('[data-scope="toast"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10000);
  expect(status).toHaveBeenCalledTimes(calls);
  expect(observe).toHaveBeenCalledTimes(observations);
  expect(vi.getTimerCount()).toBe(0);
});
