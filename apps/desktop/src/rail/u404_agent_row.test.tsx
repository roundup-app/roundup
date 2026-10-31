import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { itemOf, mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

const TREE = [workstream("g", { name: "ws" }), agent("a", "blocked", "waits on #7", { parent: "g", name: "gate" }), agent("b", "needs-you", "asks: keep v1 routes?", { parent: "g", name: "asker", order: 1 })];

describe("u404 an Agent row is its Glyph and its name", () => {


  it("u404_the_accessible_name_keeps_the_status_label", async () => {
    await mountRail(TREE);

    expect(itemOf("gate").getAttribute("aria-label")).toBe("gate, waits on #7");
    expect(itemOf("asker").getAttribute("aria-label")).toBe("asker, asks: keep v1 routes?");
  });





  it("u404_selection_keeps_the_band_and_bar", async () => {
    const { rail } = await mountRail(TREE);

    rail.select("a");

    expect(rowOf("gate").getAttribute("aria-selected")).toBe("true");
    expect(rowOf("gate").getAttribute("data-selected")).toBe("true");
  });

  it("u404_no_state_moves_a_row", async () => {
    const { rail } = await mountRail(TREE);
    const order = () => screen.getAllByRole("treeitem").flatMap((row) => row.getAttribute("data-id") ?? []);
    const before = order();

    fireEvent.mouseEnter(rowOf("gate"));
    rail.select("b");
    fireEvent.click(rowOf("ws").querySelector('button[aria-label="Collapse"]')!);
    fireEvent.click(rowOf("ws").querySelector('button[aria-label="Expand"]')!);

    expect(order()).toEqual(before);
  });
});
