import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowNames } from "./railFixture";
import type { Pad } from "@contracts/pad/Pad";

afterEach(cleanup);

const notes: Pad = { incarnation: "fixture-1", name: "notes", owner: { kind: "user", id: "you", parent: null }, text: "", updated_at: 0, revision: 1, home: null };

describe("u433 the Rail", () => {
  it("u433_rail_shows_no_scribe_row", async () => {
    await mountRail([workstream("w", { name: "ws", order: 0 })], [], undefined, undefined, undefined, [notes]);

    await waitFor(() => expect(rowNames()).toEqual(["ws"]));
  });

  it("u433_an_agent_named_scribe_is_an_ordinary_row", async () => {
    await mountRail(
      [workstream("w", { name: "ws", order: 0 }), agent("s", "working", "editing", { name: "scribe", order: 1 })],
      [],
      undefined,
      undefined,
      undefined,
      [notes],
    );

    await waitFor(() => expect(rowNames()).toEqual(["ws", "scribe"]));
  });
});
