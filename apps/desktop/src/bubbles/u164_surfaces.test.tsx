import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { contrastRatio, tokensOf } from "../testing/contrast";
import { lookLiterals } from "../testing/lookLiterals";
import tokenCss from "../tokens.css?inline";
import bubbleCss from "./styles.css?inline";
import { mountBubbles } from "./bubblesFixture";

afterEach(cleanup);

const hex = (value: number): string => Math.round(value).toString(16).padStart(2, "0");

/** `top` laid over `bottom` at `alpha`, as the bubble's ground over what the pane holds. */
const over = (top: string, bottom: string, alpha: number): string => {
  const channel = (colour: string, at: number) => Number.parseInt(colour.slice(1 + at * 2, 3 + at * 2), 16);

  return `#${[0, 1, 2].map((at) => hex(channel(top, at) * alpha + channel(bottom, at) * (1 - alpha))).join("")}`;
};

const darkTokens = (): Map<string, string> => {
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokenCss)![1]!;

  return new Map([...tokensOf(tokenCss), ...[...dark.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match): [string, string] => [match[1]!, match[2]!.trim()])]);
};

describe("u164 surfaces and contrast", () => {
  it("u164_u134_allows_the_bubble_border_and_translucent_ground_and_nothing_else", () => {
    expect(lookLiterals(bubbleCss)).toEqual([]);
    expect(bubbleCss).not.toMatch(/box-shadow|backdrop-filter/);
    expect(bubbleCss).toMatch(/\.bubble\s*\{[^}]*border:\s*1px solid var\(--hairline\)/);
    expect(bubbleCss).toMatch(/\.bubble::before\s*\{[^}]*background:\s*var\(--ground\)[^}]*opacity:\s*var\(--bubble-ground\)/);
    expect(bubbleCss.match(/border:/g)).toHaveLength(2);
  });

  it.each([
    ["light", tokensOf(tokenCss)],
    ["dark", darkTokens()],
  ])("u164_text_reads_at_4_5_to_1_at_the_default_over_ink_and_paper (%s)", (_scheme, tokens) => {
    const text = tokens.get("text")!;
    const ground = tokens.get("ground")!;

    for (const behind of [text, ground]) expect(contrastRatio(text, over(ground, behind, 0.92))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light", tokensOf(tokenCss)],
    ["dark", darkTokens()],
  ])("u164_the_header_slider_and_chip_keep_4_5_to_1_at_every_setting (%s)", (_scheme, tokens) => {
    const text = tokens.get("text")!;
    const grey = tokens.get("grey")!;
    const ground = tokens.get("ground")!;

    // The header, slider and chip paint `--ground` opaque under their own text, whatever the bubble's ground opacity.
    expect(contrastRatio(text, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(grey, ground)).toBeGreaterThanOrEqual(4.5);
    expect(bubbleCss).toMatch(/\.bubble-chip\s*\{[^}]*background:\s*var\(--ground\)/);
  });

  it("u164_the_bubble_layer_floats_over_the_stack", async () => {
    await mountBubbles("a");
    await waitFor(() => expect(document.querySelector(".bubbles")).not.toBeNull());

    expect(document.querySelector(".bubbles")!.parentElement!.className).toBe("centre-stack");
  });
});
