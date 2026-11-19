import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { LinksView, specOf } from "../links/catalogue";
import { copy } from "../links/copy";
import terminal from "./styles.css?raw";
import links from "../links/styles.css?raw";

// jsdom lays nothing out, so each overlay's box is read from the rule that places it, in Tokens: the inset's size, and each overlay's
// top edge and height against it.
const space = { "--space-1": 4, "--space-2": 8, "--space-5": 24, "--space-6": 32 } satisfies Record<string, number>;

const rule = (sheet: string, selector: string): string => {
  const at = sheet.indexOf(`\n${selector} {`);

  if (at < 0) throw new Error(`no rule ${selector}`);

  return sheet.slice(at, sheet.indexOf("}", at));
};

const px = (value: string): number => {
  const token = /var\((--space-\d)\)/.exec(value)?.[1];

  if (token === undefined) return value.trim() === "0" ? 0 : Number.NaN;

  return Object.entries(space).find(([name]) => name === token)?.[1] ?? Number.NaN;
};

const prop = (block: string, name: string): string | undefined => new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(block)?.[1];

const inset = px(prop(rule(terminal, ".pane-body"), "--terminal-inset") ?? "");

const within = (top: string | undefined, size: string | undefined): void => {
  const start = px(top ?? "0");
  const end = start + (size === "var(--terminal-inset)" ? inset : px(size ?? ""));

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeLessThanOrEqual(inset);
};

it("lh12_no_overlay_on_the_terminal_intersects_a_text_row", () => {
  // The inset is the expanded header's height: top gap, a 24 px icon, bottom gap (LH6).
  expect(inset).toBeGreaterThanOrEqual(px("var(--space-1)") * 2 + px("var(--space-5)"));

  const header = rule(links, ".links-header");

  expect(px(prop(header, "inset-block-start") ?? "") + px("var(--space-5)")).toBeLessThanOrEqual(inset);

  const line = rule(terminal, ".pane-over");

  within(prop(line, "inset-block-start"), prop(line, "block-size"));
  expect(prop(rule(terminal, ".pane .terminal-find"), "top")).toBe("0");
  within("0", prop(rule(terminal, ".pane .terminal-find"), "block-size"));
  within(prop(rule(terminal, ".pane .pane-latest"), "top"), "var(--space-5)");
  // No overlay counts from a text row, and the Terminal's own padding is the inset.
  expect(terminal).not.toContain("--over-row");
  expect(prop(rule(terminal, ".pane .xterm"), "padding-top")).toBe("var(--terminal-inset)");
});

afterEach(cleanup);

it("lh13_the_plus_n_reveal_is_one_row_beside_the_count_inside_the_inset", async () => {
  // One row: neither the header nor the reveal wraps, so neither is taller than a icon plus its gaps, which the inset holds.
  expect(prop(rule(links, ".links-header"), "flex-wrap")).toBe("nowrap");
  expect(prop(rule(links, ".app-popover.links-popover"), "flex-wrap")).toBe("nowrap");
  expect(prop(rule(links, ".app-popover.links-popover"), "padding")).toBe("var(--space-1)");

  const entries = Array.from({ length: 6 }, (_, n) => ({ kind: "asked" as const, url: `https://example.test/${n}`, tooltip: `asked ${n}` }));

  render(() => <div class="links-header"><LinksView spec={specOf({ entries })} env={{ editor() {}, terminal() {}, open() {} }} shown={0} /></div>);
  const count = screen.getByRole("button", { name: copy.moreName(8) });
  const header = count.closest<HTMLElement>(".links-header");
  const box = (left: number, width: number) => new DOMRect(left, 38, width, 32);

  // The header is 200 px wide and the count 30: the reveal is placed against the header, so the popup reports the header's width.
  if (!header) throw new Error("no header");

  header.getBoundingClientRect = () => box(100, 200);
  count.getBoundingClientRect = () => box(270, 30);
  fireEvent.click(count);

  // The reveal opens left of the header on its row, so it covers neither the header's icons nor a row of text.
  const popover = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".links-popover");

    if (!found) throw new Error("not open");

    return found;
  });

  expect(popover.getAttribute("data-side")).toBe("left");
  expect(popover.querySelectorAll("button").length).toBe(8);
  await waitFor(() => expect(popover.style.getPropertyValue("--anchor-width")).toBe("200px"));
});
