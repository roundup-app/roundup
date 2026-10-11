import { waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { card, decision, mountApp, select } from "./decisionsFixture";

const destructive = decision("d1", "a", { args: JSON.stringify({ command: "rm -rf build && cargo build --release" }) });

describe("u383 allow and deny are told apart before they are read", () => {
  for (const width of [1280, 700]) {
    it(`u383_allow_and_deny_differ_in_colour_at_${width}`, async () => {
      window.innerWidth = width;
      await mountApp([destructive]);
      select("alpha");
      await waitFor(() => expect(card()).not.toBeNull());

      const allow = within(card()!).getByRole("button", { name: "allow" });
      const deny = within(card()!).getByRole("button", { name: "deny" });

      expect(deny.getAttribute("data-button")).toBe("primary");
      expect(allow.getAttribute("data-button")).toBe("quiet");
      expect(getComputedStyle(deny).color).not.toBe(getComputedStyle(allow).color);
      expect(getComputedStyle(deny).fontWeight).toBe(getComputedStyle(allow).fontWeight);
      expect(getComputedStyle(deny).fontSize).toBe(getComputedStyle(allow).fontSize);
    });
  }
});
