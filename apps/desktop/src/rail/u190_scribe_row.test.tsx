import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowNames } from "./railFixture";

afterEach(cleanup);

describe("u190 a Scribe on the Rail", () => {
  it("u190_scribe_row_none_for_a_working_scribe", async () => {
    await mountRail([workstream("w", { name: "ws", order: 0 })]);

    await waitFor(() => expect(rowNames()).toEqual(["ws"]));
  });

  it("u190_scribe_row_a_needs_you_scribe_is_a_root_row_after_the_last_workstream", async () => {
    await mountRail([
      workstream("w1", { name: "one", order: 0 }),
      workstream("w2", { name: "two", order: 1 }),
      agent("s", "needs-you", "asks", { name: "scribe", order: 2 }),
    ]);

    await waitFor(() => expect(rowNames()).toEqual(["one", "two", "scribe"]));
  });
});
