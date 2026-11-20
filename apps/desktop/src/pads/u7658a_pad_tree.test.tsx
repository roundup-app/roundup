import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AGENT, openShelf, padOf } from "./padsFixture";

const DAY = 86_400_000;

afterEach(cleanup);

it("u7658a_every_pad_treeitem_has_the_named_pads_tree_as_ancestor", async () => {
  await openShelf([padOf("fresh", AGENT), { ...padOf("old", AGENT), updated_at: 1 }], false, false, "/p", { now: 20 * DAY, read: { "fixture-old": "1" } });
  const tree = screen.getByRole("tree", { name: "Pads" });
  const items = screen.getAllByRole("treeitem");

  expect(items.length).toBeGreaterThan(0);
  expect(items.every(item => tree.contains(item))).toBe(true);
  expect(items.every(item => item.closest('[role="tree"]') !== null)).toBe(true);
});
