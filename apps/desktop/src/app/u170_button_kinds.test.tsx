import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import appCss from "../styles.css?inline";
import tokenCss from "../tokens.css?inline";

const sheets = import.meta.glob<string>("../**/*.css", { query: "?raw", import: "default", eager: true });

const [guide = ""] = Object.values(import.meta.glob<string>("../../../../docs/design-system.md", { query: "?raw", import: "default", eager: true }));

const KINDS = ["primary", "quiet", "add", "row-action", "icon"];

const OWNED_BY_BUTTONS_CSS = /(?:^|[\s;])(?:background(?:-color)?|color|border-radius|padding(?:-[a-z]+)?)\s*:/;

/** The Milkdown editor builds its own toolbar buttons; `buttons.css` styles them by their place, they carry no kind. */
const MILKDOWN = ".milkdown";

const rulesOf = (css: string) => [...css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => ({ selector: rule[1]!.trim(), body: rule[2]! }));

const shell = (() => {
  const sheet = document.createElement("style");
  sheet.textContent = `${tokenCss}\n${appCss}`;

  return sheet;
})();

afterEach(() => {
  shell.remove();
  cleanup();
});

const mountEverything = async () => {
  document.head.prepend(shell);
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
  fireEvent.click((await screen.findAllByRole("button", { name: /#5/ }))[0]!);
  await screen.findByRole("complementary", { name: "drawer" });
};

/** A row is not a button (U170): a Rail `treeitem` row, a Shelf row and a Todo's title. */
const isRow = (el: Element) => (el.getAttribute("role") === "treeitem" && el.hasAttribute("data-id")) || el.matches(".pad-name, .todo-row-button") || el.closest(MILKDOWN) !== null;

describe("u170 button kinds", () => {
  it("u170_design_system_defines_exactly_five_kinds", () => {
    const section = guide.slice(guide.indexOf("### Button kinds"), guide.indexOf("## Surfaces and depth"));

    const kinds = section
      .split("\n")
      .filter((row) => /^\| (primary|quiet|add|row action|icon button|\w[\w ]*) \|/.test(row) && !row.startsWith("| Kind") && !row.startsWith("|---"))
      .map((row) => row.split("|")[1]!.trim().replace("row action", "row-action").replace("icon button", "icon"));

    expect(kinds).toEqual(KINDS);
  });

  it("u170_buttons_css_holds_one_rule_per_kind_and_no_other_stylesheet_styles_a_button", () => {
    const all = Object.entries(sheets);
    const own = rulesOf(sheets["../buttons.css"]!);

    for (const kind of KINDS) expect(own.filter((rule) => rule.selector === `[data-button="${kind}"]`), kind).toHaveLength(1);

    const offenders = all
      .filter(([file]) => file !== "../buttons.css")
      .flatMap(([file, css]) => rulesOf(css).filter((rule) => /(^|[\s>+~,])button\b|\[data-button|\.word\b/.test(rule.selector) && OWNED_BY_BUTTONS_CSS.test(rule.body)).map((rule) => `${file} ${rule.selector}`));

    expect(offenders).toEqual([]);
  });

  it("u170_no_other_rule_that_matches_a_rendered_button_sets_its_background_colour_radius_or_padding", async () => {
    await mountEverything();
    const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule): rule is CSSStyleRule => "selectorText" in rule);
    const buttons = [...document.querySelectorAll("button")].filter((el) => !el.closest(MILKDOWN));
    const found: string[] = [];

    for (const el of buttons)
      for (const rule of rules) {
        if (!OWNED_BY_BUTTONS_CSS.test(rule.style.cssText) || !rule.selectorText.split(",").some((selector) => el.matches(selector.trim().replace(/:(hover|active|focus-visible)/g, "")))) continue;

        const own = Object.values(sheets["../buttons.css"]!.includes(rule.selectorText) ? [rule.selectorText] : []);

        if (own.length === 0) found.push(`${el.textContent?.trim().slice(0, 12)} ${rule.selectorText}`);
      }

    expect(found).toEqual([]);
  });

  it("u170_every_button_carries_one_kind_and_a_row_carries_none", async () => {
    await mountEverything();
    const targets = [...document.querySelectorAll("button, [role=button], [role=treeitem]")];
    const buttons = targets.filter((el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button");

    expect(buttons.length).toBeGreaterThan(15);

    for (const el of buttons) {
      const name = `${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)} (${el.className})`;

      if (isRow(el)) expect(el.hasAttribute("data-button"), name).toBe(false);
      else expect(KINDS, name).toContain(el.getAttribute("data-button"));
    }

    for (const row of targets.filter((el) => el.tagName !== "BUTTON" && el.hasAttribute("data-id"))) expect(row.hasAttribute("data-button")).toBe(false);

    // `primary` is the Door's start action of an empty pane; this screen holds the other four.
    expect(new Set(buttons.flatMap((el) => el.getAttribute("data-button") ?? []))).toEqual(new Set(KINDS.filter((kind) => kind !== "primary")));
  });

  it("u170_the_new_tokens_are_in_the_table_with_a_light_and_a_dark_value", () => {
    for (const token of ["--pressed", "--disabled"]) {
      expect(guide, token).toMatch(new RegExp(`\\| \`${token}\` \\| [^|]+ \\| [^|]+ \\|`));
      expect(tokenCss.match(new RegExp(`${token}:`, "g")), token).toHaveLength(2);
    }
  });
});
