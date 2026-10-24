import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { rowGlyph as glyphOf, itemOf, mountRail, rowNames, rowOf, settled } from "./railFixture";
import { agent, event, workstream } from "../testing/nodes";

afterEach(cleanup);

describe("u6 rows", () => {
  it("u6_each_node_is_one_row_in_order_under_its_parent", async () => {
    await mountRail([
      workstream("migrate", { order: 1 }),
      agent("rename-cols", "working", "writing", { parent: "migrate", order: 1 }),
      agent("backfill", "idle", "idle", { parent: "migrate", order: 0 }),
      agent("checkout", "working", "planning", { order: 0 }),
    ]);

    expect(rowNames()).toEqual(["checkout", "migrate", "backfill", "rename-cols"]);
  });

  it("u6_an_agent_shows_the_glyph_of_its_status_kind", async () => {
    await mountRail([agent("gateway", "needs-you", "asks")]);

    expect(glyphOf("gateway").getAttribute("aria-label")).toBe("Needs-you");
  });

  it("u6_a_door_shows_its_status_glyph", async () => {
    await mountRail([workstream("checkout", { attempt: "1", status: { kind: "idle", label: "idle", since: 0 } })]);

    expect(glyphOf("checkout").getAttribute("aria-label")).toBe("Idle");
  });

  it("u6_a_plain_group_shows_a_down_triangle", async () => {
    await mountRail([workstream("migrate")]);

    expect(rowOf("migrate").querySelector("button[aria-label=Collapse] svg.lucide-chevron-down")).not.toBeNull();
  });

  it("u6_the_selected_row_has_a_faint_band", async () => {
    const { rail } = await mountRail([agent("a", "working", "w"), agent("b", "working", "w", { order: 1 })]);

    rail.select("b");

    expect([itemOf("a").getAttribute("aria-selected"), itemOf("b").getAttribute("aria-selected")]).toEqual(["false", "true"]);
  });

  it("u6_clicking_a_row_selects_it", async () => {
    const { rail } = await mountRail([agent("a", "working", "w")]);

    fireEvent.click(rowOf("a"));
    await settled();

    expect(rail.selected()).toBe("a");
  });

  it("u6_rows_never_reorder_when_a_status_changes", async () => {
    const { app, rail } = await mountRail([
      agent("a", "working", "w", { order: 0 }),
      agent("b", "working", "w", { order: 1 }),
    ]);

    app.emit(event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id: "b", status: { kind: "error", label: "x", since: 2 } } }));
    await rail.settled();

    expect([rowNames(), glyphOf("b").getAttribute("aria-label")]).toEqual([["a", "b"], "Error"]);
  });
});
