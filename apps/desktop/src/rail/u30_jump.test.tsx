import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Kind } from "@contracts/Kind";
import { leaderKey } from "../keys/leaderFixture";
import { mountRail, rowOf } from "./railFixture";
import { agent, workstream, door, MINUTE, NOW, terminal } from "../testing/nodes";

afterEach(cleanup);

const since = (id: string, kind: Kind, minutesAgo: number, over = {}) =>
  agent(id, kind, "x", { status: { kind, label: "x", since: NOW - minutesAgo * MINUTE, finished: "0" }, ...over });

const jump = () => leaderKey("KeyJ");

describe("u30 jump", () => {
  it("u30_leader_j_selects_error_before_needs_you", async () => {
    const { rail } = await mountRail([since("ask", "needs-you", 30), since("boom", "error", 1)]);

    jump();

    expect(rail.selected()).toBe("boom");
  });

  it("u30_within_a_kind_the_oldest_status_comes_first", async () => {
    const { rail } = await mountRail([since("new", "needs-you", 1), since("old", "needs-you", 9)]);

    jump();

    expect(rail.selected()).toBe("old");
  });

  it("u30_a_second_jump_selects_the_next_and_wraps_after_the_last", async () => {
    const { rail } = await mountRail([since("a", "error", 5), since("b", "needs-you", 5)]);

    jump();
    jump();
    jump();

    expect(rail.selected()).toBe("a");
  });

  it("u30_a_door_that_needs_you_is_visited", async () => {
    const { rail } = await mountRail([door("lead", "needs-you", "x")]);

    jump();

    expect(rail.selected()).toBe("lead");
  });

  it("u30_with_none_leader_j_changes_nothing", async () => {
    const { rail } = await mountRail([since("a", "working", 1), since("b", "working", 1)]);

    rail.select("b");
    jump();

    expect(rail.selected()).toBe("b");
  });

  it("u30_with_none_selected_and_none_needing_you_leader_j_does_not_throw", async () => {
    const onError = vi.fn();
    window.addEventListener("error", onError);

    const { rail } = await mountRail([since("a", "working", 1)]);
    jump();

    window.removeEventListener("error", onError);

    expect(onError).not.toHaveBeenCalled();
    expect(rail.selected()).toBeNull();
  });

  it("u30_equal_kind_and_status_age_are_taken_in_the_daemons_order", async () => {
    const { rail } = await mountRail([since("first", "needs-you", 5), since("second", "needs-you", 5)]);

    jump();

    expect(rail.selected()).toBe("first");
  });

  it("u30_a_terminal_is_never_visited", async () => {
    const { rail } = await mountRail([terminal("t"), since("a", "needs-you", 1)]);

    jump();

    expect(rail.selected()).toBe("a");
  });

  it("u30_the_row_scrolls_into_view", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    await mountRail([since("a", "needs-you", 1)]);

    jump();

    await vi.waitFor(() => expect(scroll.mock.contexts).toEqual([rowOf("a")]));
  });

  it("u30_a_collapsed_group_expands_to_show_the_row", async () => {
    await mountRail([workstream("g"), since("a", "needs-you", 1, { parent: "g" })]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));

    jump();

    expect(rowOf("a")).toBeDefined();
  });

  it("u30_the_rail_does_not_reorder", async () => {
    await mountRail([since("first", "working", 1, { order: 0 }), since("last", "error", 1, { order: 1 })]);

    jump();

    expect(screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id")).map((row) => row.querySelector(".name")?.textContent)).toEqual(["first", "last"]);
  });
});

describe("u48 leader J after the Daemon exited", () => {
  it("u48_after_daemon_exited_leader_j_still_selects", async () => {
    const [exit] = createSignal({ code: 1 });
    const { rail } = await mountRail([since("a", "needs-you", 1)], [], exit);

    jump();

    expect(rail.selected()).toBe("a");
  });
});
