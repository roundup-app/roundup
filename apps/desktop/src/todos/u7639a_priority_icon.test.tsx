import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

stubDialogLayout();

const levels = [
  [null, "No priority", "minus", "priority-unset"], ["low", "Low", "arrow-down", "priority-low"], ["medium", "Medium", "equal", "priority-medium"],
  ["high", "High", "arrow-up", "priority-high"], ["urgent", "Urgent", "chevrons-up", "priority-urgent"],
] as const;

const open = async (priority: (typeof levels)[number][0]) => {
  await mountTodos([todo(3, { priority })]);
  const row = await screen.findByRole("button", { name: "Idle #3 todo 3" });
  row.focus();

  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });

  return within(screen.getByRole("complementary", { name: "Drawer" }));
};

it("u7639a_each_priority_shows_its_icon_and_tone", async () => {
  for (const [priority, label, icon, tone] of levels) {
    const panel = await open(priority);
    const control = await panel.findByRole("button", { name: "Priority" });
    const mark = control.querySelector(".priority-icon");

    if (!mark) throw new Error("no priority icon");

    expect(control.textContent).toBe(label);
    expect(mark.className).toContain(tone);
    expect(mark.getAttribute("data-icon")).toBe(icon);
    expect(mark.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
  }
});

it("u7639a_menu_items_carry_the_level_icon", async () => {
  const panel = await open(null);

  fireEvent.click(await panel.findByRole("button", { name: "Priority" }));

  for (const [, label, icon, tone] of levels) {
    const item = await screen.findByRole("menuitem", { name: label });
    const mark = item.querySelector(".priority-icon");

    if (!mark) throw new Error("no priority icon");

    expect(mark.className).toContain(tone);
    expect(mark.getAttribute("data-icon")).toBe(icon);
  }
});
