import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { notice, notices } from "../testing/notices";
import { agent } from "../testing/nodes";
import { mountRail } from "./railFixture";

afterEach(cleanup);

it("u7314a_rail_failures_show_as_toasts", async () => {
  const mounted = await mountRail([agent("a", "idle", "x"), agent("b", "idle", "x", { order: 1 })]);
  const tree = screen.getByRole("tree", { name: "Rail" });
  const rows = () => [...tree.querySelectorAll("[role=treeitem]")];
  const before = rows();
  const lines = () => [...document.querySelectorAll(".reserved-line:not([data-empty='true'])")].filter(line => !line.closest(".app-toasts"));
  mounted.app.handlers["rail.createWorkstream"] = () => { throw new Error("new command failure"); };

  await mounted.rail.createWorkstream();
  const shown = await waitFor(() => notice("alert"));
  const region = screen.getByRole("region", { name: "Updates" });
  expect(notices("alert")).toEqual([shown]);
  expect(region.contains(shown)).toBe(true);
  expect(lines()).toHaveLength(0);
  expect(rows()).toEqual(before);

  fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(lines()).toHaveLength(0);
  expect(rows()).toEqual(before);
});
