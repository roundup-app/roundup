import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { openTabs, tab } from "./stripFixture";

afterEach(cleanup);

describe("u182 a Project tab has no hover label", () => {
  it("u6220a_hover_and_focus_show_no_tooltip_on_a_marked_or_plain_tab", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [agent("b", "idle", "x")] });

    for (const name of ["api", "web"]) {
      fireEvent.pointerOver(tab(name), { pointerType: "mouse" });
      fireEvent.keyDown(document.body, { key: "Tab" });
      tab(name).focus();
      // Past Ark's 400 ms open delay.
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(screen.queryByRole("tooltip")).toBeNull();
      expect(tab(name).hasAttribute("aria-describedby")).toBe(false);
      expect(tab(name).closest(".project-tab")!.querySelectorAll("[title]")).toHaveLength(0);
    }
  });

  it("u182_the_dock_badge_is_the_sum_over_every_project", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x")], web: [agent("b", "error", "x"), agent("c", "needs-you", "x"), agent("d", "idle", "x")] });

    await waitFor(() => expect(app.badges.at(-1)).toBe(3));
  });
});
