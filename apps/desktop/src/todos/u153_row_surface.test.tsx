import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import rowCss from "./rowButton.styles.css?inline";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import { mountTodos, todo, todoRowOf as rowOf } from "./testHarness";

const sheet = document.createElement("style");

sheet.textContent = `${rowCss}\n${appCss}\n${inkCss}`;

beforeEach(() => document.head.appendChild(sheet));

afterEach(() => {
  cleanup();
  sheet.remove();
});

const seed = () => [todo(1), todo(2, { blocked: true, blockers: [1] }), todo(3)];

const style = (el: Element) => getComputedStyle(el);

// U359 narrows U153: a row is plain on the Shelf's `--sunken` (the Rail's row), spaced by Tokens, with its Glyph in its own column.
describe("u153 the row surface and rhythm", () => {
  it("u153_a_row_is_plain_with_token_padding_above_and_below_and_none_beside", async () => {
    await mountTodos(seed());
    await screen.findByText(/todo 3/);

    for (const id of [1, 2]) {
      const row = style(rowOf(id));

      expect([row.backgroundColor, row.paddingTop, row.paddingBottom, row.paddingLeft, row.paddingRight]).toEqual(["rgba(0, 0, 0, 0)", "var(--space-1)", "var(--space-1)", "0", "0"]);
      expect([row.borderStyle, row.boxShadow, row.borderRadius]).toEqual([expect.stringMatching(/^(|none)$/), expect.stringMatching(/^(|none)$/), expect.stringMatching(/^(|0px)$/)]);
    }
  });

  it("u153_rows_touch_and_the_list_has_no_padding", async () => {
    await mountTodos(seed());
    await screen.findByText(/todo 3/);

    const list = rowOf(1).parentElement!;

    expect([style(list).display, style(list).rowGap]).toEqual(["block", "normal"]);
    expect([style(list).paddingTop, style(list).paddingBottom, style(list).paddingLeft, style(list).paddingRight]).toEqual(Array(4).fill("0"));
  });

  it("u153_the_row_button_is_a_24px_hit_and_body_text", async () => {
    await mountTodos(seed());

    const button = await screen.findByRole("button", { name: /^idle #1 / });

    expect([style(button).minHeight, style(button).fontSize, style(button).color]).toEqual(["var(--space-5)", "var(--text-body)", "var(--text)"]);
  });

  it("u153_the_meta_line_is_caption_grey", async () => {
    await mountTodos(seed());
    await screen.findByText(/todo 3/);

    const line = rowOf(2).querySelector("[data-todo-meta]")!;

    expect([style(line).fontSize, style(line).color]).toEqual(["var(--text-caption)", "var(--grey)"]);
  });

  it("u153_hover_and_selected_wash_the_row_at_once_with_no_transition", async () => {
    await mountTodos(seed());
    await screen.findByText(/todo 3/);

    const row = rowOf(1);

    expect(style(row).backgroundImage).toBe("none");
    expect(style(row).transitionDuration).toMatch(/^(|0s)$/);

    fireEvent.click(await screen.findByRole("button", { name: /^idle #1 / }));
    await screen.findByRole("complementary", { name: "drawer" });

    expect(row.getAttribute("data-selected")).toBe("true");
    expect(style(row).backgroundImage).toBe("linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--selected), var(--selected))");
    expect(rowOf(3).getAttribute("data-selected")).toBeNull();
    expect(style(row).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});
