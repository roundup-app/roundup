import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { openTabs, tab } from "./stripFixture";

afterEach(cleanup);

describe("u182 hover tells the count", () => {
  it.each([
    [[agent("a", "needs-you", "x"), agent("b", "needs-you", "x")], [2, 0]],
    [[agent("a", "error", "x")], [0, 1]],
    [[agent("a", "error", "x"), agent("b", "needs-you", "x"), agent("c", "idle", "x")], [1, 1]],
  ])("u182_the_text_for_each_mix_%#", async (nodes, counts) => {
    await openTabs({ api: nodes, web: [] });

    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });

    expect((await screen.findByRole("tooltip")).textContent?.match(/\d+/g)?.map(Number)).toEqual(counts);
    expect(tab("api").getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);

    fireEvent.pointerLeave(tab("api"));

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("u3299d_a_tab_with_no_mark_preserves_its_name", async () => {
    await openTabs({ api: [agent("a", "idle", "x")] });

    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });

    expect((await screen.findByRole("tooltip")).textContent).toBe("api");
  });

  it("u182_keyboard_focus_shows_it_and_blur_hides_it", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    fireEvent.keyDown(document.body, { key: "Tab" });
    tab("api").focus();

    const tooltip = await screen.findByRole("tooltip");
    await waitFor(() => expect(tab("api").getAttribute("aria-describedby")).toBe(tooltip.id));

    tab("api").blur();

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("u182_the_dock_badge_is_the_sum_over_every_project", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x")], web: [agent("b", "error", "x"), agent("c", "needs-you", "x"), agent("d", "idle", "x")] });

    await waitFor(() => expect(app.badges.at(-1)).toBe(3));
  });


});
