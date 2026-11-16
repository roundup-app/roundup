import { cleanup, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { copy } from "./copy";
import { itemOf, mountRail } from "./railFixture";

afterEach(cleanup);

it("mc71_remove_keeps_agents_and_their_projects", async () => {
  const alpha = agent("a", "working", "go", { name: "alpha", machine: "gone" });

  await mountRail([alpha], [], undefined, undefined, { machines: [] });
  await waitFor(() => expect(within(itemOf("alpha")).queryByRole("img", { name: copy.machineOffline })).not.toBeNull());
});
