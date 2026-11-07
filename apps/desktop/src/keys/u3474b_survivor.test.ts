import { describe, expect, it } from "vitest";
import { afterElseBefore, nearest } from "./survivor";

const order = ["a", "b", "c", "d", "e"];

const only = (...ids: string[]) => (id: string) => ids.includes(id);

describe("survivor", () => {
  it.each([
    ["a kept row after the pivot", "b", only("a", "c", "e"), "c"],
    ["none after: the nearest before", "e", only("a", "c"), "c"],
    ["only the pivot kept", "c", only("c"), "c"],
    ["nothing kept", "c", only(), undefined],
  ])("u3474b_after_else_before_picks_the_first_kept_row_after_then_before: %s", (_, pivot, kept, want) => {
    expect(afterElseBefore(order, pivot, kept)).toBe(want);
  });

  it("u3751_nearest_prefers_the_later_row_on_a_tie", () => {
    expect(nearest(order, "c", only("b", "d"))).toBe("d");
    expect(nearest(order, "c", only("a", "d"))).toBe("d");
    expect(nearest(order, "c", only("b", "e"))).toBe("b");
    expect(nearest(order, "c", only())).toBeUndefined();
  });
});
