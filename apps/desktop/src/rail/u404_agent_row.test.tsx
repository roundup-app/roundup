import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

const TREE = [workstream("g", { name: "ws" }), agent("a", "blocked", "waits on #7", { parent: "g", name: "gate" }), agent("b", "needs-you", "asks: keep v1 routes?", { parent: "g", name: "asker", order: 1 })];

describe("u404 an Agent row is its Glyph and its name", () => {
  it("u404_a_row_draws_no_live_line_or_age", async () => {
    await mountRail(TREE);

    expect(document.querySelector(".live, .live-label, .live-age, .value")).toBeNull();
    expect([...rowOf("gate").querySelector(".line")!.children].map((el) => el.className)).toEqual(expect.arrayContaining([expect.stringContaining("glyph"), "name"]));
  });

  it("u404_the_title_keeps_the_status_label", async () => {
    await mountRail(TREE);

    fireEvent.pointerMove(rowOf("gate"), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("waits on #7");
    fireEvent.pointerLeave(rowOf("gate"), { pointerType: "mouse" });
    fireEvent.pointerMove(rowOf("asker"), { pointerType: "mouse" });
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("asks: keep v1 routes?"));
  });

  it("u404_ink_rows_carry_their_tone", async () => {
    await mountRail(TREE);

    expect(rowOf("asker").querySelector(".name")?.getAttribute("data-tone")).toBe("amber");
    expect(rowOf("gate").querySelector(".name")?.getAttribute("data-tone")).toBeNull();
  });

  it("u404_the_owned_control_is_a_diamond_and_a_count", async () => {
    await mountRail(TREE, [], () => null, undefined, {}, [{ incarnation: "fixture-1", name: "notes", owner: { kind: "agent", id: "a", parent: null }, text: "", updated_at: 0, revision: 1, home: null }]);

    const control = rowOf("gate").querySelector<HTMLElement>("[data-pads-control]")!;

    await screen.findByRole("button", { name: "1 pads" });
    expect(control.textContent?.trim()).toBe("1");
    expect(control.querySelector("svg")).not.toBeNull();
    expect(rowOf("asker").querySelector("[data-pads-control]")).toBeNull();
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
    fireEvent.click(rowOf("ws").querySelector('button[aria-label="Collapse"]')!);

    expect(order()).toEqual(before);
  });
});
