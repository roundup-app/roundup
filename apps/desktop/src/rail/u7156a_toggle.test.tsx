import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { WindowBar } from "../header/WindowBar";
import { Layout } from "../window/Layout";
import { RailToggle } from "./RailToggle";

const src = join(__dirname, "..");

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);

it("u7156a_the_toggle_is_a_button_inside_the_rail_named_for_the_state", () => {
  const onToggle = vi.fn();

  // A strip and a peek are both the collapsed state, so both read `Expand the Rail`; an open Rail reads `Collapse the Rail`.
  for (const [collapsed, name, expanded] of [[false, "Collapse the Rail", "true"], [true, "Expand the Rail", "false"]] as const) {
    const { container, unmount } = render(() => <RailToggle collapsed={collapsed} onToggle={onToggle} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-label$="the Rail"]');

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("aria-label")).toBe(name);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe(expanded);
    buttons[0]?.click();
    unmount();
  }

  expect(onToggle).toHaveBeenCalledTimes(2);

  const bar = render(() => (
    <WindowBar app={{ setWindowTitle: vi.fn(async () => {}), dragWindow: vi.fn(async () => {}), zoomWindow: vi.fn(async () => {}) }} project="roundup" rail={undefined} onFailure={() => {}}><div /></WindowBar>
  ));

  expect(bar.container.querySelector('button[aria-label$="the Rail"]')).toBeNull();
});

it("u7156b_the_icon_follows_the_state", () => {
  for (const [collapsed, glyph] of [[false, "panel-left-close"], [true, "panel-left-open"]] as const) {
    const { container, unmount } = render(() => <RailToggle collapsed={collapsed} onToggle={() => {}} />);

    expect(container.querySelector(`button svg.lucide-${glyph}`)).not.toBeNull();
    unmount();
  }
});

it("u7156a_no_element_outside_the_sliding_rail_toggles_it_or_transitions_its_position", () => {
  // Only the Layout (the strip) and the Rail (its WORKSTREAMS header) render the toggle, both inside the Rail section.
  const users = walk(src).filter(file => /\.tsx?$/.test(file) && !/\.test\./.test(file) && readFileSync(file, "utf8").includes("<RailToggle"));

  expect(users.map(file => file.slice(src.length + 1))).toEqual(["rail/Rail.tsx", "window/Layout.tsx"]);

  const layout = readFileSync(join(src, "window/Layout.tsx"), "utf8");
  const rail = layout.slice(layout.indexOf('class="rail"'), layout.indexOf("</section>", layout.indexOf('class="rail"')));

  expect(rail.match(/<StripHead/g)).toHaveLength(1);
  expect(layout.match(/<StripHead/g)).toHaveLength(1);
  expect(layout.match(/<RailToggle/g)).toHaveLength(1);

  const css = readFileSync(join(src, "styles.css"), "utf8");

  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.rail-(toggle|strip-head)/.test((selector ?? ""))) expect(body ?? "", selector).not.toMatch(/transition/);
  }


  expect(css).not.toMatch(/\.rail-handle/);
});

// The surfaces that slide themselves; every other selector with a position transition is an attached part following another element.
const SLIDING = [".rail[data-collapsed] .rail-body", ".shelf-edge-slot", ".shelf", ".window[data-shelf-maximised", ".window:has(.drawer[data-open=\"true\"]:not([data-fill=\"true\"])) .shelf", ".app-toast"];

const POSITION = /transition:[^;]*\b(left|right|top|bottom|inset|translate|transform)\b/;

it("u7156c_no_stylesheet_rule_transitions_the_position_of_an_attached_part", () => {
  const offenders: string[] = [];

  for (const file of walk(src).filter(name => name.endsWith(".css"))) {
    for (const [, selector, body] of readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
      const sel = (selector ?? "").trim();

      if (POSITION.test((body ?? "")) && !SLIDING.some(own => sel.startsWith(own)) && !/transform: scale|branch-indicator|\.icon|\.rail-create-menu|\.toast|\[data-sortable|reorder/i.test(sel + (body ?? ""))) offenders.push(`${file.slice(src.length + 1)}: ${sel}`);
    }
  }

  expect(offenders).toEqual([]);
});
