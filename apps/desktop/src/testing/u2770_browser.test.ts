import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("u2770_pointer_and_keyboard_focus", async () => {
  for (const scheme of ["light", "dark"] as const) {
    const lane = await openLane(1512, scheme, "u2770");
    try {
      const pads = "#shelf-tab-pads";
      const focused = (selector: string) => `document.activeElement === document.querySelector(${JSON.stringify(selector)})`;
      const ring = () => lane.evaluate<string>("getComputedStyle(document.activeElement).outlineStyle");
      await lane.browser("click", pads);
      await lane.until(focused(pads));
      expect(await ring()).toBe("none");
      await lane.capture("pointer-no-ring", "shelf-click");
      await lane.browser("press", "ArrowLeft");
      await lane.until(focused("#shelf-tab-todos"));
      expect(await ring()).toBe("solid");
      await lane.capture("pointer-no-ring", "shelf-keyboard");
      await lane.browser("click", pads);
      await lane.until(focused(pads));
      expect(await ring()).toBe("none");
    } finally { await lane.close(); }
  }
}, 180_000);
