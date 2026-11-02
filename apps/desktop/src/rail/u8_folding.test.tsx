import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, rowNames, rowOf } from "./railFixture";
import { agent, workstream, door, MINUTE, NOW } from "../testing/nodes";

afterEach(cleanup);

describe("u8 Workstream folding", () => {
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
