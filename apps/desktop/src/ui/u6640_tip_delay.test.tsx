import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Tip } from "./Tip";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u6640c_a_tooltip_opens_at_200_ms", async () => {
  vi.useFakeTimers();
  render(() => <Tip text="Hello">{trigger => <button {...trigger()}>Target</button>}</Tip>);
  const target = screen.getByRole("button");

  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
  fireEvent.pointerMove(target, { pointerType: "mouse", clientX: 10, clientY: 10 });
  await vi.advanceTimersByTimeAsync(199);
  expect(screen.queryByRole("tooltip")).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByRole("tooltip")).toBeTruthy();
});
