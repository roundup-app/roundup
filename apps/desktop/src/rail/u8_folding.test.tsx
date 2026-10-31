import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { mountRail, rowNames, rowOf } from "./railFixture";
import { agent, workstream, door, MINUTE, NOW } from "../testing/nodes";

afterEach(cleanup);

const doneFor = (id: string, minutes: number, over: Partial<RailNode> = {}): RailNode =>
  agent(id, "done", "finished", { status: { kind: "done", label: "finished", since: NOW - minutes * MINUTE, finished: "0" }, ...over });

describe("u8 folding", () => {
  it("u8_agents_done_for_10_minutes_fold_into_one_line_after_their_siblings", async () => {
    await mountRail([
      doneFor("old-1", 10, { order: 0 }),
      doneFor("old-2", 90, { order: 1 }),
      agent("busy", "working", "w", { order: 2 }),
    ]);

    const summary = screen.getByRole("treeitem", { name: "2 done" });

    expect([rowNames(), summary.textContent?.trim()]).toEqual([["busy"], "2 done"]);
  });

  it("u8_an_agent_done_for_under_10_minutes_stays_in_its_row", async () => {
    await mountRail([doneFor("fresh", 9, { order: 0 }), agent("busy", "working", "w", { order: 1 })]);

    expect([rowNames(), screen.queryByText(/done$/)]).toEqual([["fresh", "busy"], null]);
  });

  it("u8_an_agent_folds_once_the_clock_passes_10_minutes_of_done", async () => {
    const { setNow } = await mountRail([doneFor("fresh", 9)]);

    setNow(NOW + 2 * MINUTE);

    expect(screen.getByText("1 done")).toBeDefined();
  });

  it("u8_clicking_the_done_line_unfolds_its_agents", async () => {
    await mountRail([doneFor("old-1", 20, { order: 0 }), agent("busy", "working", "w", { order: 1 })]);

    fireEvent.click(screen.getByText("1 done"));

    expect([rowNames(), screen.queryByText("1 done")]).toEqual([["busy", "old-1"], null]);
  });

  it("u8_each_parent_folds_its_own_done_agents_at_its_own_depth", async () => {
    await mountRail([
      workstream("migrate"),
      doneFor("inner", 30, { parent: "migrate" }),
      doneFor("outer", 30, { order: 1 }),
    ]);

    expect(screen.getAllByText("1 done")).toHaveLength(2);
  });

  it("u8_a_door_never_folds_even_when_done", async () => {
    await mountRail([door("lead", "done", "d", { status: { kind: "done", label: "d", since: NOW - 60 * MINUTE, finished: "0" } })]);

    expect(rowNames()).toEqual(["lead"]);
  });

  it("u8_another_click_expands_a_collapsed_group", async () => {
    await mountRail([workstream("migrate"), agent("a", "working", "w", { parent: "migrate" })]);
    fireEvent.click(rowOf("migrate").querySelector("button[aria-label=Collapse]")!);

    fireEvent.click(rowOf("migrate").querySelector("button[aria-label=Expand]")!);

    expect(rowNames()).toEqual(["migrate", "a"]);
  });

  it("u8_collapsing_a_group_does_not_select_it", async () => {
    const { rail } = await mountRail([workstream("g")]);

    fireEvent.click(rowOf("g").querySelector("button[aria-label=Collapse]")!);

    expect(rail.selected()).toBeNull();
  });


});
