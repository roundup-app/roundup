import { describe, expect, it } from "vitest";
import { planDrop, treeRows } from "./todoView";
import { todo } from "./testHarness";

// 1 ⟵ 2 ⟵ 3 (3 waits on 2, 2 on 1), and a top-level 4.
const list = [todo(1), todo(2, { blocked: true, blockers: [1] }), todo(3, { blocked: true, blockers: [2] }), todo(4)];

const plan = (id: number, parent: number | null, index: number) => planDrop(treeRows(list), list, list, id, parent, index);

describe("u3710 dragging sideways sets depth and dragging vertically sets order", () => {
  it("u3710_a_sideways_drag_calls_set_blockers_and_a_vertical_one_calls_reorder", () => {
    // 4 nests under 3 where it sits: blockers only.
    expect(plan(4, 3, 0)).toEqual({ blockers: [3] });
    // 2 un-nests to level 1 after 1: its first blocker is dropped, the place is kept.
    expect(plan(2, null, 1)).toEqual({ blockers: [] });
    // 4 moves above 1 at level 1: order only.
    expect(plan(4, null, 0)).toEqual({ before: 1 });
  });

  it("u3710_a_drag_that_changes_both_sets_blockers_then_reorders", () => {
    // 4 nests under 1 ahead of 2: blockers and order.
    expect(plan(4, 1, 0)).toEqual({ blockers: [1], before: 2 });
  });

  it("u3710_depth_is_bounded_by_the_row_above", () => {
    // A drop with no change calls nothing.
    expect(plan(4, null, 1)).toEqual({});
    // Dragging 2 takes 3 along: 3 is no drop target and its blockers never change.
    expect(planDrop(treeRows(list), list, list, 2, 4, 0).blockers).toEqual([4]);
  });
});
