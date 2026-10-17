import { screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { card, decision, mountApp, select } from "./decisionsFixture";
import { FULLSCREEN } from "../testing/chromePage";

const long = decision("d1", "a", { args: JSON.stringify({ command: `echo ${"x".repeat(300)}` }) });

describe("u194 a Decision's allow and deny are never covered by the order line", () => {
  for (const width of [FULLSCREEN.width]) {
    it(`u194_the_buttons_stay_in_the_cards_visible_area_at_${width}`, async () => {
      window.innerWidth = width;
      await mountApp([long]);
      select("alpha");
      await waitFor(() => expect(card()).not.toBeNull());

      const row = card()!.querySelector<HTMLElement>(".decision-buttons")!;
      const region = card()!.querySelector<HTMLElement>(".decision-args")!;
      const scrolls = (node: HTMLElement) => getComputedStyle(node).overflow === "auto";

      // jsdom has no layout, so the rule that puts the row outside every scroll region is asserted; rectangles and elementFromPoint are read by the observe.sh of U194 (output in observer.txt).
      expect(getComputedStyle(card()!)).toMatchObject({ display: "flex", flexDirection: "column", overflow: "hidden" });
      expect(scrolls(region)).toBe(true);
      expect(region.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(row.parentElement).toBe(card());
      expect(getComputedStyle(row).position).not.toBe("sticky");

      for (const name of ["Allow", "Deny"]) {
        for (let node = within(card()!).getByRole("button", { name }).parentElement; node && node !== card()!.parentElement; node = node.parentElement) {
          if (node !== card()) expect(scrolls(node)).toBe(false);
        }
      }

      expect(within(card()!).getByRole("button", { name: "Allow" })).toBeTruthy();
      expect(within(card()!).getByRole("button", { name: "Deny" })).toBeTruthy();
      expect(screen.queryAllByRole("button", { name: "Allow" })).toHaveLength(1);
    });
  }
});
