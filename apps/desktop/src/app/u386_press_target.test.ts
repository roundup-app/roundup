import { describe, expect, it } from "vitest";
import appCss from "../styles.css?inline";

describe("U386 a press shows on the target under the pointer only", () => {
  it("u386_row_press_yields_to_a_pressed_button", () => {
    // jsdom does not match `:active`; the computed values are read on `just harness` in agent-browser.
    const rule = appCss.match(/\.rail-row:active([^{]*)\{([^}]*)\}/);

    expect(rule?.[1]).toContain(":not(:has(:active:is(button");
    expect(rule?.[2]).toContain("var(--pressed)");
    expect(rule?.[2]).toContain("transition-duration: 0s");
  });
});
