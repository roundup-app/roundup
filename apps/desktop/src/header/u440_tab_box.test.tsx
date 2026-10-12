import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import tokenStyles from "../tokens.css?inline";
import appStyles from "../styles.css?inline";
import stripStyles from "./strip.styles.css?inline";
import buttonStyles from "../buttons.css?inline";
import { colourOf, contrastRatio, loadTokens, resolveToken } from "../testing/contrast";
import { agent } from "../testing/nodes";
import { header, openTabs, tab } from "./stripFixture";

afterEach(cleanup);

const withStyles = async <T,>(run: () => Promise<T>): Promise<T> => {
  const sheet = document.head.appendChild(document.createElement("style"));

  sheet.textContent = `${tokenStyles}\n${appStyles}\n${stripStyles}\n${buttonStyles}`;

  try {
    return await run();
  } finally {
    sheet.remove();
  }
};

/** The declarations of the first rule for `selector` in `sheet`; jsdom leaves `var()` and shorthands unresolved, so the rule text is what is read. */
const rule = (sheet: string, selector: string): string => {
  const at = sheet.indexOf(`\n${selector} {`);

  return at < 0 ? "" : sheet.slice(at, sheet.indexOf("}", at));
};

const box = (name: string): HTMLElement => tab(name).parentElement!;

describe("u440 a Project tab is one box on one centre line", () => {
  it("u440_a_tab_is_one_bordered_box", async () => {
    await withStyles(async () => {
      await openTabs({ api: [agent("a", "error", "x")], web: [] });
      const declared = rule(stripStyles, ".project-tab");

      expect(declared).toContain("border: 1px solid var(--hairline)");
      expect(declared).toMatch(/padding: 0 var\(--space-1\) var\(--space-2\) var\(--space-2\)/);
      expect(box("api").contains(tab("api"))).toBe(true);
      expect(box("api").contains(box("api").querySelector(".tab-close"))).toBe(true);
      expect(box("api").contains(box("api").querySelector(".tab-mark"))).toBe(true);
    });
  });

  it("u440_name_close_and_plus_share_a_centre_line", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });

      for (const declared of [rule(appStyles, ".header"), rule(stripStyles, ".strip"), rule(stripStyles, ".tablist"), rule(stripStyles, ".project-tab"), rule(stripStyles, ".tab-name-button")]) {
        expect(declared).not.toContain("baseline");
      }

      expect(rule(stripStyles, ".project-tab")).toContain("align-items: center");
      expect(rule(appStyles, ".header")).toContain("align-items: center");
    });
  });

  it("u442_tabs_rest_on_the_header_rule", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });

      expect(rule(stripStyles, ".strip")).toContain("align-items: stretch");
      expect(rule(appStyles, ".header")).toContain("border-bottom: 1px solid var(--hairline)");
    });
  });

  it("u440_a_tab_has_no_project_icon", async () => {
    await openTabs({ api: [], web: [] });

    expect(Array.from(box("api").querySelectorAll("svg")).filter((icon) => !icon.closest(".tab-close"))).toHaveLength(0);
  });

  it("u440_clip_overflow_and_rename_fit_the_box", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });
      const style = getComputedStyle(box("api"));

      expect(style.boxSizing).toBe("border-box");
      expect(rule(buttonStyles, "button")).toContain("min-height: var(--space-5)");
    });
  });
});

describe("u441 hover and selection colour the whole box", () => {
  it("u441_hover_colours_the_whole_box", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });

      expect(rule(stripStyles, ".project-tab:hover")).toContain("linear-gradient(var(--hover), var(--hover))");
      expect(rule(stripStyles, ".tab-name-button")).toContain("--button-hover-surface: var(--button-surface)");
      expect(rule(stripStyles, ".tab-close")).not.toContain("--button-hover-surface");
      expect(rule(stripStyles, ".project-tab:hover")).not.toContain("padding");
    });
  });

  it("u441_selected_ground_is_lighter_and_keeps_contrast", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });
      const { tokens, ground } = loadTokens();

      expect(box("web").getAttribute("data-selected")).toBe("true");
      expect(box("api").getAttribute("data-selected")).toBe("false");
      expect(rule(stripStyles, '.project-tab[data-selected="true"]')).toContain("background-color: var(--ground)");
      expect(rule(stripStyles, '.project-tab[data-selected="true"]:hover')).toContain("var(--selected-hover)");
      expect(colourOf(tab("web"), tokens)).toBe(resolveToken("var(--text)", tokens));
      expect(contrastRatio(colourOf(tab("api"), tokens), ground)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("u441_hover_and_selection_move_no_other_tab", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });
      const before = box("api").style.cssText;

      fireEvent.pointerEnter(box("web"));
      fireEvent.click(tab("web"));

      expect(box("api").style.cssText).toBe(before);
      expect(getComputedStyle(box("api")).position).toBe("relative");
    });
  });
});

describe("u442 a hairline runs under the header", () => {
  it("u442_a_hairline_runs_under_the_header", async () => {
    await withStyles(async () => {
      await openTabs({ api: [], web: [] });
      const declared = rule(appStyles, ".header");

      expect(declared).toContain("border-bottom: 1px solid var(--hairline)");
      expect(declared).toContain("padding: 8px 16px 0");
      expect(rule(stripStyles, ".project-tab")).toContain("border-bottom: 0");
    });
  });

  it("u442_the_rule_shows_with_no_project", async () => {
    await withStyles(async () => {
      await openTabs({});

      expect(header().querySelector(".tablist")?.children).toHaveLength(0);
      expect(rule(appStyles, ".header")).toContain("border-bottom: 1px solid var(--hairline)");
    });
  });
});

describe("u443 the Tab mark is a small dot after the name", () => {
  it("u443_the_mark_is_a_small_dot_by_the_name", async () => {
    await withStyles(async () => {
      await openTabs({ api: [agent("a", "error", "x")], web: [agent("b", "needs-you", "x")], docs: [agent("c", "working", "x")] });
      const dot = (name: string) => box(name).querySelector(".tab-mark");

      expect(dot("api")?.querySelector("*")).toBeNull();
      expect(dot("api")?.textContent).toBe("");
      expect(dot("api")?.getAttribute("data-tone")).toBe("red");
      expect(dot("web")?.getAttribute("data-tone")).toBe("amber");
      expect(rule(stripStyles, ".tab-mark")).toMatch(/width: var\(--space-2\);\s+height: var\(--space-2\);\s+border-radius: var\(--radius-drawer\)/);
      expect(rule(stripStyles, ".tab-mark")).toContain("translateY(-0.35em)");
      expect(dot("docs")).toBeNull();
    });
  });

  it("u443_the_mark_keeps_its_rule_name_and_click", async () => {
    await openTabs({ api: [agent("a", "error", "x"), agent("b", "needs-you", "x")], web: [] });

    expect(box("api").querySelector(".tab-mark")?.getAttribute("aria-label")).toBe("error");
    expect(tab("api").textContent).toBe("api");
  });

  it("u443_the_dot_keeps_contrast", async () => {
    const { tokens, ground } = loadTokens();

    expect(contrastRatio(resolveToken("var(--red)", tokens), ground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(resolveToken("var(--amber)", tokens), ground)).toBeGreaterThanOrEqual(3);
  });
});
