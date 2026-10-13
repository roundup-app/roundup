import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agent } from "../testing/nodes";
import { mountToasts, status } from "./toastFixture";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([
  ["needs-you", "Needs you"],
  ["error", "Failed"],
] as const)("u416_toast_status_uses_sentence_case_for_%s", async (kind, line) => {
  const { app } = await mountToasts([agent("a", "working", "busy", { name: "keep lowercase" })]);

  app.emit(status("a", kind));
  await vi.advanceTimersByTimeAsync(0);

  const toast = screen.getByRole("button", { name: `keep lowercase ${line}` });

  expect(toast.querySelector(".toast-name")?.textContent).toBe("keep lowercase");
  expect(toast.querySelector(".toast-line")?.textContent).toBe(line);
});
