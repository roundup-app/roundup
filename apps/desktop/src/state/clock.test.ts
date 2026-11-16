import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNow, NOW_TICK_MS } from "./clock";

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

describe("u4 the reactive clock", () => {
  it("u4_now_starts_at_the_injected_clock", () => {
    const [now, dispose] = createRoot(dispose => [createNow(() => 1000), dispose] as const);

    expect(now()).toBe(1000);
    dispose();
  });

  it("u4_now_follows_the_injected_clock_each_tick", () => {
    let time = 1000;
    const [now, dispose] = createRoot(dispose => [createNow(() => time), dispose] as const);

    flush();
    time = 61_000;
    vi.advanceTimersByTime(NOW_TICK_MS);
    flush();

    expect(now()).toBe(61_000);
    dispose();
  });

  it("u4_now_does_not_move_between_ticks", () => {
    let time = 1000;
    const [now, dispose] = createRoot(dispose => [createNow(() => time), dispose] as const);

    flush();
    time = 61_000;
    vi.advanceTimersByTime(NOW_TICK_MS - 1);
    flush();

    expect(now()).toBe(1000);
    dispose();
  });
});

it("u3308_idle_display_demand_shares_the_clock_and_sleeps_without_catch_up", () => {
  vi.setSystemTime(0);
  const [visible, show] = createSignal(true);
  const [active, activate] = createSignal(false, { equals: false });
  const [second, demand] = createSignal(false);
  const clock = vi.fn(() => Date.now());

  const [board, dispose] = createRoot(dispose => {
    const now = createNow(clock, () => false, visible);

    now.subscribe(second);

    return [now.subscribe(active), dispose] as const;
  });

  flush();
  vi.advanceTimersByTime(120_000);
  activate(true);
  flush();
  expect(board()).toBe(120_000);
  const reads = clock.mock.calls.length;
  activate(true);
  demand(true);
  flush();
  expect(vi.getTimerCount()).toBe(1);
  expect(clock).toHaveBeenCalledTimes(reads);
  vi.advanceTimersByTime(60_000);
  flush();
  expect(board()).toBe(180_000);
  activate(false);
  flush();
  expect(vi.getTimerCount()).toBe(1);
  demand(false);
  flush();
  expect(vi.getTimerCount()).toBe(0);
  activate(true);
  show(false);
  flush();
  const asleep = clock.mock.calls.length;
  vi.advanceTimersByTime(3_600_000);
  flush();
  expect(clock).toHaveBeenCalledTimes(asleep);
  show(true);
  flush();
  expect(clock).toHaveBeenCalledTimes(asleep + 1);
  expect(board()).toBe(3_780_000);
  expect(vi.getTimerCount()).toBe(1);
  dispose();
  expect(vi.getTimerCount()).toBe(0);
});
