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
