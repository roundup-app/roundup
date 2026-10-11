import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { driveStates, outlineRulesIn, styleIn } from "../testing/pointerStates";
import appCss from "../styles.css?inline";
import tokenCss from "../tokens.css?inline";
import padsCss from "./styles.css?inline";

let sheet: HTMLStyleElement | null = null;

let undrive = () => {};

afterEach(() => {
  undrive();
  sheet?.remove();
  cleanup();
});

const field = () => {
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = `${tokenCss}\n${appCss}\n${padsCss}`;
  render(() => (
    <p class="pad-ask">
      <input aria-label="Ask or edit this pad" />
    </p>
  ));
  undrive = driveStates();

  return document.querySelector<HTMLElement>(".pad-ask input")!;
};

describe("u388 the Pad Drawer's ask field answers like the other fields", () => {
  it("u388_the_ask_field_rests_as_a_token_box", () => {
    const el = field();
    const rest = styleIn(el, "rest");
    const border = getComputedStyle(el);

    // jsdom resolves no computed border colour from a Token, so the colour is read from the rule that sets it.
    const rule = /\.pad-ask input\s*\{[^}]*\}/.exec(padsCss)![0];

    expect(border.borderStyle).toBe("solid");
    expect(rule).toContain("border-color: var(--hairline);");
    expect(rest.getPropertyValue("background-color")).toBe("var(--ground)");
    expect(rest.getPropertyValue("color")).toBe("var(--text)");
    expect(rest.getPropertyValue("min-height")).toBe("var(--space-5)");
  });

  it("u388_the_ask_field_washes_on_hover", () => {
    const el = field();

    expect(styleIn(el, "hover").getPropertyValue("background-color")).toBe("var(--hover)");
    expect(styleIn(el, "hover").getPropertyValue("background-color")).not.toBe(styleIn(el, "rest").getPropertyValue("background-color"));
    expect(styleIn(el, "pressed").getPropertyValue("background-color")).toBe("var(--selected)");
  });

  it("u388_the_ask_field_shows_the_accent_focus_ring", () => {
    const el = field();

    expect(outlineRulesIn(el, "focus")).toEqual(["[data-state-focus]"]);
    expect(styleIn(el, "focus").getPropertyValue("outline-width")).toBe("2px");
    expect(styleIn(el, "focus").getPropertyValue("outline-color")).toBe("var(--accent)");
  });
});
