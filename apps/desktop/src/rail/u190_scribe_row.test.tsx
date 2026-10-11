import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowNames } from "./railFixture";
import type { Pad } from "@contracts/pad/Pad";

afterEach(cleanup);

const notes = (scribe: string | null): Pad => ({ name: "notes", owner: { kind: "user", id: "you", parent: null }, text: "", updated_at: 0, home: null, scribe });

describe("u190 a Scribe on the Rail", () => {
  it("u190_scribe_row_after_reopen_from_pad_scribe", async () => {
    await mountRail([
      workstream("w", { name: "ws", order: 0 }),
      agent("s", "working", "editing", { name: "scribe", order: 1 }),
    ], [], undefined, undefined, undefined, [notes("s")]);

    await waitFor(() => expect(rowNames()).toEqual(["ws"]));
  });

  it("u190_scribe_row_a_needs_you_scribe_is_a_root_row_after_the_last_workstream", async () => {
    await mountRail([
      workstream("w1", { name: "one", order: 0 }),
      workstream("w2", { name: "two", order: 1 }),
      agent("s", "needs-you", "asks", { name: "scribe", order: 2 }),
    ], [], undefined, undefined, undefined, [notes("s")]);

    await waitFor(() => expect(rowNames()).toEqual(["one", "two", "scribe"]));
  });
});
