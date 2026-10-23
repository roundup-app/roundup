import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNow, NOW_TICK_MS } from "./clock";

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

describe("u4 the reactive clock", () => {
  it("u4_now_starts_at_the_injected_clock", () => {
    createRoot((dispose) => {
      expect(createNow(() => 1000)()).toBe(1000);
      dispose();
    });
  });

  it("u4_now_follows_the_injected_clock_each_tick", () => {
    let time = 1000;

    createRoot((dispose) => {
      const now = createNow(() => time);
      time = 61_000;
      vi.advanceTimersByTime(NOW_TICK_MS);

      expect(now()).toBe(61_000);
      dispose();
    });
  });

  it("u4_now_does_not_move_between_ticks", () => {
    let time = 1000;

    createRoot((dispose) => {
      const now = createNow(() => time);
      time = 61_000;
      vi.advanceTimersByTime(NOW_TICK_MS - 1);

      expect(now()).toBe(1000);
      dispose();
    });
  });

  it("u4_one_timer_serves_the_app_and_unmounting_clears_it", () => {
    const counts: number[] = [];

    createRoot((dispose) => {
      createNow(() => 0);
      counts.push(vi.getTimerCount());
      dispose();
    });
    counts.push(vi.getTimerCount());

    expect(counts).toEqual([1, 0]);
  });
});

it("u3308_idle_display_demand_shares_the_clock_and_sleeps_without_catch_up", () => {
  createRoot((dispose) => {
    const [visible, show] = createSignal(true);
    const [active, activate] = createSignal(false);
    const clock = vi.fn(() => Date.now());
    const now = createNow(clock, () => false, visible);
    const board = now.subscribe(active);
    const [second, demand] = createSignal(false);
    now.subscribe(second);
    vi.advanceTimersByTime(120_000);
    activate(true);
    expect(board()).toBe(Date.now());
    const reads = clock.mock.calls.length;
    activate(true);
    demand(true);
    expect(vi.getTimerCount()).toBe(1);
    expect(clock).toHaveBeenCalledTimes(reads);
    vi.advanceTimersByTime(60_000);
    expect(board()).toBe(Date.now());
    activate(false);
    expect(vi.getTimerCount()).toBe(1);
    demand(false);
    expect(vi.getTimerCount()).toBe(0);
    activate(true);
    show(false);
    const asleep = clock.mock.calls.length;
    vi.advanceTimersByTime(3_600_000);
    expect(clock).toHaveBeenCalledTimes(asleep);
    show(true);
    expect(clock).toHaveBeenCalledTimes(asleep + 1);
    expect(board()).toBe(Date.now());
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
