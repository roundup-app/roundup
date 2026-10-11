import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { rememberScribe } from "../pads/scribe";
import { mountRail, rowNames } from "./railFixture";

afterEach(cleanup);

describe("u190 a Scribe on the Rail", () => {
  it("u190_scribe_row_none_for_a_working_scribe", async () => {
    const { connected } = await mountRail([
      workstream("w", { name: "ws", order: 0 }),
      agent("s", "working", "editing", { name: "scribe", order: 1 }),
    ]);

    await waitFor(() => expect(rowNames()).toEqual(["ws", "scribe"]));
    rememberScribe(connected, "notes", "s");

    await waitFor(() => expect(rowNames()).toEqual(["ws"]));
  });

  it("u190_scribe_row_a_needs_you_scribe_is_a_root_row_after_the_last_workstream", async () => {
    const { connected } = await mountRail([
      workstream("w1", { name: "one", order: 0 }),
      workstream("w2", { name: "two", order: 1 }),
      agent("s", "needs-you", "asks", { name: "scribe", order: 2 }),
    ]);

    rememberScribe(connected, "notes", "s");

    await waitFor(() => expect(rowNames()).toEqual(["one", "two", "scribe"]));
  });
});
