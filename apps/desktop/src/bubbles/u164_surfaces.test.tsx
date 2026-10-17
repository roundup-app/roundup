import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { contrastRatio, tokensOf } from "../testing/contrast";
import tokenCss from "../tokens.css?raw";
import bubbleCss from "./styles.css?inline";
import { mountBubbles } from "./bubblesFixture";

afterEach(cleanup);

const darkTokens = (): Map<string, string> => {
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokenCss)![1]!;

  return new Map([...tokensOf(tokenCss), ...[...dark.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match): [string, string] => [match[1]!, match[2]!.trim()])]);
};

describe("u164 surfaces and contrast", () => {
  it.each([
    ["light", tokensOf(tokenCss)],
    ["dark", darkTokens()],
  ])("u523_text_reads_at_4_5_to_1_on_the_opaque_panel (%s)", (_scheme, tokens) => {
    const text = tokens.get("text")!;
    const grey = tokens.get("grey")!;
    const ground = tokens.get("ground")!;

    expect(contrastRatio(text, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(grey, ground)).toBeGreaterThanOrEqual(4.5);
    // U2232: an inactive tab's grey label sits on the bar's --sunken ground; the selected label on --ground.
    expect(contrastRatio(grey, tokens.get("sunken")!)).toBeGreaterThanOrEqual(4.5);
    expect(bubbleCss).not.toMatch(/\.terminal-tab\s*\{[^}]*--button-surface/);
  });

  it("u164_the_bubble_layer_floats_over_the_stack", async () => {
    await mountBubbles("a");
    await waitFor(() => expect(document.querySelector(".bubbles")).not.toBeNull());

    expect(document.querySelector(".bubbles")!.parentElement!.className).toBe("centre-stack");
  });
});
