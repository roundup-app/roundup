import { expect, it } from "vitest";
import designSystem from "../../../../docs/design-system.md?raw";

it("u453_design_system_uses_supported_viewports", () => {
  const d10 = designSystem.match(/^\| D10 \| (.+) \| U135 \|$/m)?.[1];
  const d11 = designSystem.match(/^\| D11 \| (.+) \| U197 \|$/m)?.[1];

  expect(d10).toBe("D1 to D9 hold in both colour schemes, in `prefers-contrast: more`, and at 1280 by 800");
  expect(d11).toBe("in the Thread, the column is at most `--measure` (`56rem`) wide, no rendered line holds more than 120 characters, and every row's text starts at one x within 1 px, at 1280 by 800");
  expect(designSystem.match(/\b\d+ by \d+\b/g)).toEqual(["1280 by 800", "1280 by 800"]);
  expect(designSystem).toContain("on every visible element of the screen, in light and in dark");
});
