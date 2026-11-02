import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("u5217_plus_opens_ordered_creation_choices", async () => {
  await mountRail([workstream("g")]);
  const plus = screen.getByRole("button", { name: "Create" });
  expect(plus.hasAttribute("aria-keyshortcuts")).toBe(false);
  fireEvent.click(plus);
  const items = await screen.findAllByRole("menuitem");
  expect(items.map(item => [item.textContent?.replace(/\s+/g, " ").trim(), item.getAttribute("aria-keyshortcuts")])).toEqual([
    ["Agent⌘N", "Meta+N"], ["Workstream⌥⌘N", "Alt+Meta+N"], ["Mode⇧⌘M", "Shift+Meta+M"],
  ]);
});

it("u5217_opening_the_menu_starts_nothing", async () => {
  const m = await mountRail([workstream("g")]);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("menu");
  expect(railCallsTo(m.app, "agent.spawn")).toEqual([]);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
});
