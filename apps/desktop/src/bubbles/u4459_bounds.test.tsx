import { expect, it } from "vitest";
import { clamped, resizedAbout, ZONES } from "./places";

const saved = { x: 200, y: 300, w: 300, h: 300, min: false };

it("u4459_the_clamp_seam_holds_for_every_zone_and_delta", () => {
  const extent = { width: 800, height: 544 };

  for (const zone of ZONES) for (const dx of [-10000, -400, 0, 400, 10000]) for (const dy of [-10000, -400, 0, 400, 10000]) {
    for (const result of [clamped({ ...saved, x: dx, y: dy }, extent), resizedAbout(saved, zone, dx, dy, extent)]) {
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.y + result.h).toBeLessThanOrEqual(544);
    }
  }
});
