import { screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { card, decision, mountApp, select } from "./decisionsFixture";

const long = decision("d1", "a", { args: JSON.stringify({ command: `echo ${"x".repeat(300)}` }) });

describe("u194 a Decision's allow and deny are never covered by the order line", () => {
  for (const width of [1280, 700]) {
    it(`u194_the_buttons_stay_in_the_cards_visible_area_at_${width}`, async () => {
      window.innerWidth = width;
      await mountApp([long]);
      select("alpha");
      await waitFor(() => expect(card()).not.toBeNull());

      const buttons = card()!.querySelector<HTMLElement>(".decision-buttons")!;
      const style = getComputedStyle(buttons);

      // jsdom has no layout: the rule that keeps the row in the scrollport is the one asserted; the pointer is observed in a browser.
      expect(style.position).toBe("sticky");
      expect(style.bottom).toBe("0px");
      expect(style.backgroundColor).not.toBe("");
      expect(getComputedStyle(card()!).overflow).toBe("auto");
      expect(within(card()!).getByRole("button", { name: "allow" })).toBeTruthy();
      expect(within(card()!).getByRole("button", { name: "deny" })).toBeTruthy();
      expect(screen.queryAllByRole("button", { name: "allow" })).toHaveLength(1);
    });
  }
});
