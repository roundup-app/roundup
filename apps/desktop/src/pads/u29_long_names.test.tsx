import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openShelf, padOf } from "./padsFixture";
import inkCss from "../ink/styles.css?inline";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const LONG = "a-pad-with-a-very-long-name-here-ok";

const cut = (name: HTMLElement) => {
  const style = getComputedStyle(name);

  return [
    style.minWidth,
    style.overflow,
    style.textOverflow,
    style.whiteSpace,
    name.title,
  ];
};

describe("u29 long names", () => {
  // U359 supersedes "one line" for the Shelf: a name shows two lines and then `…`; the row's `title` holds the whole name.
  it("u29_a_long_pad_name_keeps_the_mark_and_the_name_in_one_row_and_clamps_at_two_lines", async () => {
    await openShelf([padOf(LONG, USER)]);
    const name = await screen.findByText(LONG);
    const row = name.closest("[data-shelf-row]");

    expect(row?.contains(screen.getByRole("img", { name: "user owned" }))).toBe(true);
    expect(name.closest("button")?.title).toBe(LONG);
    expect(inkCss).toMatch(/\.shelf-title\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*overflow:\s*hidden/);
  });

  it("u29_the_drawer_head_cuts_a_long_name_and_leaves_the_icons_whole", async () => {
    await openShelf([padOf(LONG, USER)]);
    fireEvent.click(await screen.findByText(LONG));
    const name = await within(await screen.findByLabelText("drawer")).findByText(LONG);
    const row = name.closest<HTMLElement>(".pad-head");

    expect(cut(name)).toEqual(["0px", "hidden", "ellipsis", "nowrap", LONG]);
    expect(row && getComputedStyle(row).display).toBe("flex");
    expect(row && getComputedStyle(within(row).getByRole("button", { name: "Export .md" })).flexShrink).toBe("0");
  });
});
