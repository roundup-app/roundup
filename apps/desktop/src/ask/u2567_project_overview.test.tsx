import { cleanup, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream } from "../testing/nodes";
import { mountAskBar } from "./askFixture";

afterEach(cleanup);

it("u2567a_entries_follow_rail_order_with_door_status", async () => {
  await mountAskBar([], null, [door("b", "working", "busy", { order: 2 }), workstream("a", { order: 1, status: null })]);

  const overview = screen.getByRole("region", { name: "Project overview" });

  expect(within(overview).getAllByRole("button").map((button) => button.textContent)).toEqual(["a", "bWorking"]);
});
