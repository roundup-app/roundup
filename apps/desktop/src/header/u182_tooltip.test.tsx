import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { header, openTabs, tab } from "./stripFixture";

afterEach(cleanup);

describe("u182 hover tells the count", () => {
  it.each([
    [[agent("a", "needs-you", "x"), agent("b", "needs-you", "x")], "2 need you · 0 error"],
    [[agent("a", "error", "x")], "0 need you · 1 error"],
    [[agent("a", "error", "x"), agent("b", "needs-you", "x"), agent("c", "idle", "x")], "1 need you · 1 error"],
  ])("u182_the_text_for_each_mix_%#", async (nodes, text) => {
    await openTabs({ api: nodes });

    fireEvent.pointerEnter(tab("api").parentElement!);

    expect((await screen.findByRole("tooltip")).textContent).toBe(text);
    expect(tab("api").getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    expect(screen.getByRole("tooltip").classList.contains("ink")).toBe(false);

    fireEvent.pointerLeave(tab("api").parentElement!);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("u182_a_tab_with_no_mark_shows_no_tooltip", async () => {
    await openTabs({ api: [agent("a", "idle", "x")] });

    fireEvent.pointerEnter(tab("api").parentElement!);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("u182_keyboard_focus_shows_it_and_blur_hides_it", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    tab("api").focus();

    expect((await screen.findByRole("tooltip")).textContent).toBe("1 need you · 0 error");

    tab("api").blur();

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("u182_the_dock_badge_is_the_sum_over_every_project", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x")], web: [agent("b", "error", "x"), agent("c", "needs-you", "x"), agent("d", "idle", "x")] });

    await waitFor(() => expect(app.badges.at(-1)).toBe(3));
  });

  it("u182_no_chip_is_in_the_header", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")] });

    expect(header().textContent).not.toContain("need you");
  });
});
