import { describe, expect, it } from "vitest";
import { contrastRatio } from "../testing/contrast";
import tokenCss from "../tokens.css?raw";

/** The Token values of one colour scheme, read from `tokens.css`: the `:root` block, then the dark column over it. */
const tokensOf = (dark: boolean) => {
  const blocks = [...tokenCss.matchAll(/:root\s*\{([^}]*)\}/g)].map((block) => block[1]!);
  const used = dark ? [blocks[0]!, blocks[1]!] : [blocks[0]!];
  const tokens = new Map<string, string>();

  for (const block of used) for (const declaration of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens.set(declaration[1]!, declaration[2]!.trim());

  return tokens;
};

describe("u171 every kind shows every state", () => {
  it("u171_the_disabled_tone_is_4_5_to_1_on_the_ground_and_the_sunken_surface_in_both_schemes", () => {
    for (const dark of [false, true]) {
      const tokens = tokensOf(dark);

      for (const ground of ["ground", "sunken"]) expect(contrastRatio(tokens.get("disabled")!, tokens.get(ground)!), `${dark ? "dark" : "light"} ${ground}`).toBeGreaterThanOrEqual(4.5);

      expect(tokens.get("disabled")).not.toBe(tokens.get("grey"));
      expect(tokens.get("pressed")).not.toBe(tokens.get("hover"));
    }
  });
});
