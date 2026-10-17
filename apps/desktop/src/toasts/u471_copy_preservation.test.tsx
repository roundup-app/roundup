import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agent, USER } from "../testing/nodes";
import { AGENT, by, mountToasts, pad, status, todo } from "./toastFixture";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["Todo", "Pad"] as const)("u471_previous_copy_assertions_are_preserved_changed_%s_keeps_glossary_case_and_authored_text", async (kind) => {
  const { app } = await mountToasts([agent("a", "working", "busy", { name: "lowercase" })], {
    todos: [todo(7, USER, "keep this TITLE")],
    pads: [pad("keep this NAME", USER)],
  });

  app.emit(by(AGENT, kind === "Todo"
    ? { name: "todo.updated", data: todo(7, USER, "keep this TITLE") }
    : { name: "pad.changed", data: { name: "keep this NAME" } }));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();

  const line = kind === "Todo" ? 'Changed Todo "keep this TITLE"' : "Changed Pad keep this NAME";

  expect(screen.getByRole("button", { name: `lowercase: ${line}` }).textContent).toBe(`lowercase ${line}`);
});

it("u471_previous_copy_assertions_are_preserved_toast_overflow_uses_sentence_case", async () => {
  const { app } = await mountToasts(Array.from({ length: 4 }, (_, at) => agent(`a${at}`, "working", "busy")));

  for (let at = 0; at < 4; at += 1) app.emit(status(`a${at}`, "needs-you"));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();

  expect(screen.getByText("And 2 more")).toBeTruthy();
});

it("u471_previous_copy_assertions_are_preserved_a_gone_toast_target_uses_sentence_case", async () => {
  const { app } = await mountToasts([agent("a", "working", "busy", { name: "lowercase" })], { reducedMotion: true });

  app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER) }));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
  fireEvent.click(screen.getByRole("button", { name: 'lowercase: Changed Todo "ship it"' }));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();

  expect(screen.getByText("That is gone")).toBeTruthy();
});

it.each([
  ["needs-you", "Needs you"],
  ["error", "Failed"],
] as const)("u471_previous_copy_assertions_are_preserved_toast_status_uses_sentence_case_for_%s", async (kind, line) => {
  const { app } = await mountToasts([agent("a", "working", "busy", { name: "keep lowercase" })]);

  app.emit(status("a", kind));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();

  const toast = screen.getByRole("button", { name: `keep lowercase: ${line}` });

  expect(toast.textContent).toBe(`keep lowercase ${line}`);
});
