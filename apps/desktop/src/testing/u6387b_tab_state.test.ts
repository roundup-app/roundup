import { afterEach, describe, expect, it } from "vitest";
import stripCss from "../header/strip.styles.css?raw";
import flatCss from "../ui/flat-tab.styles.css?raw";
import settingsCss from "../settings/styles.css?raw";
import { tabStateCheck } from "./designChecks";

afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });

const run = (css: string) => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.body.innerHTML = '<div class="project-tab" data-flat-tab></div><div class="settings-sections"><button class="app-tabs-trigger" data-selected></button></div>';
  const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => "selectorText" in rule);

  return tabStateCheck(document, rules);
};

const main = `${stripCss}\n${flatCss}\n${settingsCss}`;

describe("u6387b", () => {
  it("u6387b_a_selected_only_min_width_on_a_project_tab_fails", () => {
    const out = run(`${main}\n.project-tab[data-selected="true"] { min-width: 171px; }`);
    expect(out.status).toBe("fail");
    expect(out.value).toMatchObject({ cue: "min-width" });
  });

  it("u6387b_a_selected_only_font_weight_on_a_settings_section_fails", () => {
    const out = run(`${main}\n.settings-sections .app-tabs-trigger[data-selected] { font-weight: 600; }`);
    expect(out.status).toBe("fail");
    expect(out.value).toMatchObject({ cue: "font-weight" });
  });

  it("u6387b_main_stylesheets_pass", () => {
    expect(run(main).status).toBe("pass");
  });
});
