import { bubbleChord } from "./bubblesFixture";
import { revealBubble } from "./bubblesFixture";
import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bubbleCalls, mountBubbles } from "./bubblesFixture";
import type { Place } from "./places";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

const chip = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.bubble[data-bubble="${id}"]`)!;

const shown = (): string[] => [...document.querySelectorAll(".bubble:not([hidden])")].map((bubble) => bubble.getAttribute("data-bubble") ?? "");

const pressed = (id: string): boolean => !chip(id).hasAttribute("hidden");

describe("u2224 selecting shows output with nothing over it", () => {
  it("u2224_selecting_an_agent_minimises_every_shown_bubble", async () => {
    const mounted = await mountBubbles("w");
    await waitFor(() => expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1));

    mounted.connected.rail.select("a");
    await waitFor(() => expect(chip("1")).not.toBeNull());
    expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
    expect(document.querySelectorAll(".bubble:not([hidden])")).toHaveLength(0);
  });

  it("u2224_a_bubble_restored_after_the_selection_stays_shown", async () => {
    const mounted = await mountBubbles("w");
    await waitFor(() => expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1));

    mounted.connected.rail.select("a");
    await waitFor(() => expect(chip("1")).not.toBeNull());
    revealBubble("1");
    await waitFor(() => expect(pressed("1")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pressed("1")).toBe(true);
  });

  it("u2224_activating_a_chip_shows_that_bubble_alone", async () => {
    const mounted = await mountBubbles("w");
    await waitFor(() => expect(chip("2")).not.toBeNull());

    mounted.connected.rail.select("a");
    await waitFor(() => expect(chip("1")).not.toBeNull());
    revealBubble("1");
    await waitFor(() => expect(shown()).toEqual(["1"]));
    revealBubble("2");
    await waitFor(() => expect(shown()).toEqual(["2"]));
    expect(pressed("1")).toBe(false);
  });

  it("u2224_the_fold_closes_nothing_writes_nothing_and_keeps_place_and_size", async () => {
    const mounted = await mountBubbles("w");

    await waitFor(() => expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1));

    // The newly selected Agent's own screens attach and size themselves; the fold must send nothing for the bubble it folds.
    // SAFETY: the fake App records each call's params as the request object, which carries `id` for terminal methods.
    const calls = (): number => ["terminal.close", "terminal.write", "terminal.resize"].flatMap((method) => bubbleCalls(mounted.app, method)).filter((params) => (params as { id?: string }).id === "2").length;

    const sent = calls();

    const geometry = (): Record<string, Omit<Place, "min">> => {
      // SAFETY: the bubble store writes this key as a map of Place records.
      const stored = JSON.parse(window.sessionStorage.getItem("roundup:bubble-places:/p") ?? "{}") as Record<string, Place>;

      return Object.fromEntries(Object.entries(stored).map(([id, { min: _min, ...place }]) => [id, place]));
    };

    const before = geometry();

    expect(Object.keys(before).length).toBeGreaterThan(0);
    expect(shown()).toEqual(["2"]);

    mounted.connected.rail.select("a");
    await waitFor(() => expect(shown()).toEqual([]));
    expect(calls()).toBe(sent);
    expect(mounted.connected.rail.selected()).toBe("a");

    const after = geometry();

    for (const id of Object.keys(before)) expect(after[id]).toEqual(before[id]);
  });

  it("u2224_a_new_run_bubble_does_not_fold_on_its_own", async () => {
    const mounted = await mountBubbles("w");
    await waitFor(() => expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1));

    bubbleChord("t");
    await waitFor(() => expect(chip("9")).not.toBeNull());
    expect(pressed("9")).toBe(true);
    expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
    expect(mounted.connected.rail.selected()).toBe("w");
  });
});
