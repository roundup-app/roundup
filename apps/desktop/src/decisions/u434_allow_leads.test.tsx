import { waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { card, decision, mountApp, select } from "./decisionsFixture";
import { FULLSCREEN } from "../testing/chromePage";

const destructive = decision("d1", "a", { args: JSON.stringify({ command: "rm -rf build && cargo build --release" }) });

describe("u434 on a permission Card allow leads", () => {
  for (const width of [FULLSCREEN.width]) {
    it(`u434_allow_leads_and_differs_in_colour_at_${width}`, async () => {
      window.innerWidth = width;
      await mountApp([destructive]);
      select("alpha");
      await waitFor(() => expect(card()).not.toBeNull());

      const allow = within(card()!).getByRole("button", { name: "Allow" });
      const deny = within(card()!).getByRole("button", { name: "Deny" });

      const names = within(card()!).getAllByRole("button").map((b) => b.textContent).filter((t) => t === "Allow" || t === "Deny");
      expect(names).toEqual(["Allow", "Deny"]);
      expect(allow.getAttribute("data-button")).toBe("primary");
      expect(deny.getAttribute("data-button")).toBe("quiet");
      expect(getComputedStyle(deny).color).not.toBe(getComputedStyle(allow).color);
      expect(getComputedStyle(deny).fontWeight).toBe(getComputedStyle(allow).fontWeight);
      expect(getComputedStyle(deny).fontSize).toBe(getComputedStyle(allow).fontSize);
    });
  }
});
