import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, rowOf } from "./railFixture";
import { agent, NOW } from "../testing/nodes";

afterEach(cleanup);

const LABEL = "Claude's servers failed; send the Agent a message to retry. The next turn replaces this mark.";

describe("U5151a", () => {
  it("u5151a_stop_failure_reaches_the_rail", async () => {
    const boom = agent("boom", "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });

    await mountRail([boom]);

    expect(rowOf("boom").textContent).toContain(boom.status!.label);
  });
});
