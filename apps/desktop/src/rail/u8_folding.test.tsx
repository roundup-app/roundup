import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { mountRail, rowNames, rowOf } from "./railFixture";
import { agent, workstream, door, MINUTE, NOW, terminal } from "../testing/nodes";

afterEach(cleanup);

const doneFor = (id: string, minutes: number, over: Partial<RailNode> = {}): RailNode =>
  agent(id, "done", "finished", { status: { kind: "done", label: "finished", since: NOW - minutes * MINUTE, finished: "0" }, ...over });

/** U403: the Agent Glyphs a folded Workstream shows at its right, most urgent first. */
const foldedKinds = (name: string): (string | null)[] =>
  [...rowOf(name).querySelectorAll(".folded-agents .glyph")].map((glyph) => glyph.getAttribute("aria-label")?.toLowerCase() ?? null);

describe("u8 folding", () => {
  it("u8_agents_done_for_10_minutes_fold_into_one_line_after_their_siblings", async () => {
    await mountRail([
      doneFor("old-1", 10, { order: 0 }),
      doneFor("old-2", 90, { order: 1 }),
      agent("busy", "working", "w", { order: 2 }),
    ]);

    const summary = screen.getByRole("treeitem", { name: "2 done" });

    expect(summary.querySelectorAll("svg")).toHaveLength(1);
    expect(summary.querySelector('.glyph[data-drawing="check"] svg')?.getAttribute("aria-hidden")).toBe("true");
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

  it("u8_clicking_a_groups_chevron_collapses_it_to_its_agents_glyphs_most_urgent_first", async () => {
    await mountRail([
      workstream("migrate"),
      agent("a", "working", "w", { parent: "migrate", order: 0 }),
      agent("b", "needs-you", "asks", { parent: "migrate", order: 1 }),
    ]);

    fireEvent.click(rowOf("migrate").querySelector("button[aria-label=Collapse]")!);

    expect([rowNames(), foldedKinds("migrate"), rowOf("migrate").querySelector(".folded-agents .glyph")!.className]).toEqual([
      ["migrate"],
      ["needs-you", "working"],
      "glyph ink",
    ]);
  });

  it("u8_a_collapsed_group_shows_a_light_agent_count", async () => {
    await mountRail([
      workstream("migrate"),
      agent("a", "working", "w", { parent: "migrate", order: 0 }),
      agent("b", "idle", "i", { parent: "migrate", order: 1 }),
    ]);

    fireEvent.click(rowOf("migrate").querySelector("button[aria-label=Collapse]")!);

    expect(rowOf("migrate").querySelector(".light")?.textContent).toBe("2");
  });

  it("u8_another_click_expands_a_collapsed_group", async () => {
    await mountRail([workstream("migrate"), agent("a", "working", "w", { parent: "migrate" })]);
    fireEvent.click(rowOf("migrate").querySelector("button[aria-label=Collapse]")!);

    fireEvent.click(rowOf("migrate").querySelector("button[aria-label=Collapse]")!);

    expect([rowNames(), rowOf("migrate").querySelector("button[aria-label=Collapse] svg")?.classList.contains("lucide-chevron-down")]).toEqual([["migrate", "a"], true]);
  });

  it.each<[Kind, string]>([
    ["error", "error"],
    ["blocked", "blocked"],
    ["done", "done"],
  ])("u8_a_collapsed_group_with_a_%s_agent_below_shows_%s", async (kind, mark) => {
    await mountRail([workstream("g"), agent("a", kind, "l", { parent: "g" })]);

    fireEvent.click(rowOf("g").querySelector("button[aria-label=Collapse]")!);

    expect(foldedKinds("g")).toEqual([mark]);
  });

  it("u8_collapsing_a_group_does_not_select_it", async () => {
    const { rail } = await mountRail([workstream("g")]);

    fireEvent.click(rowOf("g").querySelector("button[aria-label=Collapse]")!);

    expect(rail.selected()).toBeNull();
  });

  it("u8_the_folded_count_counts_agents_not_children", async () => {
    await mountRail([
      workstream("g"),
      workstream("inner", { parent: "g" }),
      agent("deep", "working", "w", { parent: "inner" }),
    ]);

    fireEvent.click(rowOf("g").querySelector("button[aria-label=Collapse]")!);

    expect(rowOf("g").querySelector(".light")?.textContent).toBe("1");
  });

  it("u8_a_collapsed_group_lists_the_kinds_of_all_descendant_agents_most_urgent_first", async () => {
    await mountRail([
      workstream("outer"),
      workstream("inner", { parent: "outer", order: 0 }),
      agent("asks", "needs-you", "?", { parent: "inner", order: 0 }),
      agent("busy", "working", "w", { parent: "outer", order: 1 }),
    ]);

    fireEvent.click(rowOf("outer").querySelector("button[aria-label=Collapse]")!);

    expect(foldedKinds("outer")).toEqual(["needs-you", "working"]);
  });

  it("u8_a_collapsed_group_with_no_agent_below_shows_a_right_triangle", async () => {
    await mountRail([workstream("g"), terminal("t", { parent: "g" })]);

    fireEvent.click(rowOf("g").querySelector("button[aria-label=Collapse]")!);

    expect(rowOf("g").querySelector("button[aria-label=Collapse] svg.lucide-chevron-right")).not.toBeNull();
  });
});
