import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, pinnedAdd, rowOf } from "../rail/railFixture";

afterEach(cleanup);

describe("u471 every word the App writes is in sentence case", () => {
  it("u471_previous_copy_assertions_are_preserved_a_workstream_named_workstream_stays_lower_case", async () => {
    await mountRail([workstream("workstream")]);

    expect(rowOf("workstream").textContent).toContain("workstream");
  });

  it("u471_previous_copy_assertions_are_preserved_the_rail_add_reads_plus_workstream", async () => {
    await mountRail([]);

    expect([pinnedAdd().textContent?.trim(), pinnedAdd().getAttribute("aria-label")]).toEqual(["Workstream", "Add Workstream"]);
  });
});
